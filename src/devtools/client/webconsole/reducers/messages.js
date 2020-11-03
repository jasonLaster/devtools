/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { isGroupType, l10n } = require("devtools/client/webconsole/utils/messages");

const constants = require("devtools/client/webconsole/constants");
const { DEFAULT_FILTERS, MESSAGE_TYPE } = constants;

const { pointEquals } = require("protocol/execution-point-utils");

const { getMessageVisibility } = require("devtools/client/webconsole/utils/message-visibility")
const {
  createWarningGroupMessage,
  isWarningGroup,
  getWarningGroupType,
  getParentWarningGroupMessageId,
} = require("devtools/client/webconsole/utils/messages");

const { log } = require("protocol/socket");
const { assert, compareNumericStrings } = require("protocol/utils");

const logLimit = 1000;

const MessageState = overrides =>
  Object.freeze(
    Object.assign(
      {
        // List of all the messages added to the console.
        messagesById: new Map(),
        // List of additional data associated with messages (populated async or on-demand at a
        // later time after the message is received).
        messagesPayloadById: new Map(),
        // Array of the visible messages.
        visibleMessages: [],
        // Object for the filtered messages.
        filteredMessagesCount: getDefaultFiltersCounter(),
        // List of the message ids which are opened.
        messagesUiById: [],
        // Map of the form {groupMessageId : groupArray},
        // where groupArray is the list of of all the parent groups' ids of the groupMessageId.
        // This handles console API groups.
        groupsById: new Map(),
        // Message id of the current console API group (no corresponding console.groupEnd yet).
        currentGroup: null,
        // This group handles "warning groups" (Content Blocking, CORS, CSP, …)
        warningGroupsById: new Map(),
        // Map logpointId:pointString to messages.
        logpointMessages: new Map(),
        // Set of logpoint IDs that have been removed
        removedLogpointIds: new Set(),
        // Any execution point we are currently paused at, when replaying.
        pausedExecutionPoint: null,
        pausedExecutionPointTime: 0,
        // Whether any messages with execution points have been seen.
        hasExecutionPoints: false,
        // Id of the last messages that was added.
        lastMessageId: null,
      },
      overrides
    )
  );

function cloneState(state) {
  return {
    messagesById: new Map(state.messagesById),
    visibleMessages: [...state.visibleMessages],
    filteredMessagesCount: { ...state.filteredMessagesCount },
    messagesUiById: [...state.messagesUiById],
    messagesPayloadById: new Map(state.messagesPayloadById),
    groupsById: new Map(state.groupsById),
    currentGroup: state.currentGroup,
    logpointMessages: new Map(state.logpointMessages),
    removedLogpointIds: new Set(state.removedLogpointIds),
    pausedExecutionPoint: state.pausedExecutionPoint,
    pausedExecutionPointTime: state.pausedExecutionPointTime,
    hasExecutionPoints: state.hasExecutionPoints,
    warningGroupsById: new Map(state.warningGroupsById),
    lastMessageId: state.lastMessageId,
  };
}

/**
 * Add a console message to the state.
 *
 * @param {ConsoleMessage} newMessage: The message to add to the state.
 * @param {MessageState} state: The message state ( = managed by this reducer).
 * @param {FiltersState} filtersState: The filters state.
 * @returns {MessageState} a new messages state.
 */
// eslint-disable-next-line complexity
function addMessage(newMessage, state, filtersState) {
  const { groupsById, currentGroup } = state;

  if (newMessage.type === constants.MESSAGE_TYPE.NULL_MESSAGE) {
    // When the message has a NULL type, we don't add it.
    return state;
  }

  // After messages with a given logpoint ID have been removed, ignore all
  // future messages with that ID.
  if (
    newMessage.logpointId &&
    state.removedLogpointIds &&
    state.removedLogpointIds.has(newMessage.logpointId)
  ) {
    return state;
  }

  if (newMessage.type === constants.MESSAGE_TYPE.END_GROUP) {
    // Compute the new current group.
    state.currentGroup = getNewCurrentGroup(currentGroup, groupsById);
    return state;
  }

  // Store the id of the message as being the last one being added.
  state.lastMessageId = newMessage.id;

  // Add the new message with a reference to the parent group.
  const parentGroups = getParentGroups(currentGroup, groupsById);
  if (!isWarningGroup(newMessage)) {
    newMessage.groupId = currentGroup;
    newMessage.indent = parentGroups.length;
  }

  ensureExecutionPoint(state, newMessage);

  if (newMessage.executionPoint) {
    state.hasExecutionPoints = true;
  }

  // When replaying, we might get two messages with the same execution point and
  // logpoint ID. In this case the first message is provisional and should be
  // removed.
  const removedIds = [];
  if (newMessage.logpointId) {
    const key = `${newMessage.logpointId}:${newMessage.executionPoint}`;
    const existingMessage = state.logpointMessages.get(key);
    if (existingMessage) {
      log(`LogpointFinish ${newMessage.executionPoint}`);
      removedIds.push(existingMessage.id);
    } else {
      log(`LogpointStart ${newMessage.executionPoint}`);
    }
    state.logpointMessages.set(key, newMessage);
  }

  // Check if the current message could be placed in a Warning Group.
  // This needs to be done before setting the new message in messagesById so we have a
  // proper message.
  const warningGroupType = getWarningGroupType(newMessage);

  // If new message could be in a warning group.
  if (warningGroupType !== null) {
    const warningGroupMessageId = getParentWarningGroupMessageId(newMessage);

    // If there's no warning group for the type/innerWindowID yet
    if (!state.messagesById.has(warningGroupMessageId)) {
      // We create it and add it to the store.
      const groupMessage = createWarningGroupMessage(
        warningGroupMessageId,
        warningGroupType,
        newMessage
      );
      state = addMessage(groupMessage, state, filtersState);
    }

    // We add the new message to the appropriate warningGroup.
    state.warningGroupsById.get(warningGroupMessageId).push(newMessage.id);

    // If the warningGroup message is not visible yet, but should be.
    if (
      !state.visibleMessages.includes(warningGroupMessageId) &&
      getMessageVisibility(state.messagesById.get(warningGroupMessageId), {
        messagesState: state,
        filtersState,
      }).visible
    ) {
      // Then we put it in the visibleMessages properties, at the position of the first
      // warning message inside the warningGroup.
      // If that first warning message is in a console.group, we place it before the
      // outermost console.group message.
      const firstWarningMessageId = state.warningGroupsById.get(warningGroupMessageId)[0];
      const firstWarningMessage = state.messagesById.get(firstWarningMessageId);
      const outermostGroupId = getOutermostGroup(firstWarningMessage, groupsById);
      const groupIndex = state.visibleMessages.indexOf(outermostGroupId);
      const warningMessageIndex = state.visibleMessages.indexOf(firstWarningMessageId);

      if (groupIndex > -1) {
        // We remove the warning message
        if (warningMessageIndex > -1) {
          state.visibleMessages.splice(warningMessageIndex, 1);
        }

        // And we put the warning group before the console.group
        state.visibleMessages.splice(groupIndex, 0, warningGroupMessageId);
      } else {
        // If the warning message is not in a console.group, we replace it by the
        // warning group message.
        state.visibleMessages.splice(warningMessageIndex, 1, warningGroupMessageId);
      }
    }
  }

  // If we're creating a warningGroup, we init the array for its children.
  if (isWarningGroup(newMessage)) {
    state.warningGroupsById.set(newMessage.id, []);
  }

  const addedMessage = Object.freeze(newMessage);
  state.messagesById.set(newMessage.id, addedMessage);

  if (newMessage.type === "trace") {
    // We want the stacktrace to be open by default.
    state.messagesUiById.push(newMessage.id);
  } else if (isGroupType(newMessage.type)) {
    state.currentGroup = newMessage.id;
    state.groupsById.set(newMessage.id, parentGroups);

    if (newMessage.type === constants.MESSAGE_TYPE.START_GROUP) {
      // We want the group to be open by default.
      state.messagesUiById.push(newMessage.id);
    }
  }

  const { visible, cause } = getMessageVisibility(addedMessage, {
    messagesState: state,
    filtersState,
  });

  if (visible) {
    // If the message is part of a visible warning group, we want to add it after the last
    // visible message of the group.
    const warningGroupId = getParentWarningGroupMessageId(newMessage);
    if (warningGroupId && state.visibleMessages.includes(warningGroupId)) {
      // Defaults to the warning group message.
      let index = state.visibleMessages.indexOf(warningGroupId);

      // We loop backward through the warning group's messages to get the latest visible
      // messages in it.
      const messagesInWarningGroup = state.warningGroupsById.get(warningGroupId);
      for (let i = messagesInWarningGroup.length - 1; i >= 0; i--) {
        const idx = state.visibleMessages.indexOf(messagesInWarningGroup[i]);
        if (idx > -1) {
          index = idx;
          break;
        }
      }
      // Inserts the new warning message at the wanted location "in" the warning group.
      state.visibleMessages.splice(index + 1, 0, newMessage.id);
    } else {
      state.visibleMessages.push(newMessage.id);
    }
    maybeSortVisibleMessages(state);
  } else if (DEFAULT_FILTERS.includes(cause)) {
    state.filteredMessagesCount.global++;
    state.filteredMessagesCount[cause]++;
  }

  return removeMessagesFromState(state, removedIds);
}

// eslint-disable-next-line complexity
function messages(state = MessageState(), action) {
  const { messagesById, messagesPayloadById, messagesUiById, groupsById, visibleMessages } = state;
  const { filtersState } = action;

  log(`WebConsole ${action.type}`);

  let newState;
  switch (action.type) {
    case constants.PAUSED_EXECUTION_POINT:
      if (
        state.pausedExecutionPoint &&
        action.executionPoint &&
        pointEquals(state.pausedExecutionPoint, action.executionPoint) &&
        state.pausedExecutionPointTime == action.time
      ) {
        return state;
      }
      return {
        ...state,
        pausedExecutionPoint: action.executionPoint,
        pausedExecutionPointTime: action.time,
      };
    case constants.MESSAGES_ADD:
      // Preemptively remove messages that will never be rendered
      const list = [];
      let prunableCount = 0;
      for (let i = action.messages.length - 1; i >= 0; i--) {
        const message = action.messages[i];
        if (
          !message.groupId &&
          !isGroupType(message.type) &&
          message.type !== MESSAGE_TYPE.END_GROUP
        ) {
          prunableCount++;
          // Once we've added the max number of messages that can be added, stop.
          if (prunableCount <= logLimit) {
            list.unshift(action.messages[i]);
          } else {
            break;
          }
        } else {
          list.unshift(message);
        }
      }

      newState = cloneState(state);
      list.forEach(message => {
        newState = addMessage(message, newState, filtersState);
      });

      return limitTopLevelMessageCount(newState);

    case constants.MESSAGES_CLEAR:
      return MessageState({});

    case constants.MESSAGES_CLEAR_EVALUATIONS: {
      const removedIds = [];
      for (const [id, message] of messagesById) {
        if (message.type === MESSAGE_TYPE.COMMAND || message.type === MESSAGE_TYPE.RESULT) {
          removedIds.push(id);
        }
      }

      // If there have been no console evaluations, there's no need to change the state.
      if (removedIds.length === 0) {
        return state;
      }

      return removeMessagesFromState(
        {
          ...state,
        },
        removedIds
      );
    }

    case constants.MESSAGES_CLEAR_EVALUATION: {
      const commandId = action.messageId;

      // This assumes that messages IDs are generated sequentially, and the result's ID
      // should be the command message's ID + 1.
      const resultId = (Number(commandId) + 1).toString();

      return removeMessagesFromState(
        {
          ...state,
        },
        [commandId, resultId]
      );
    }

    case constants.MESSAGES_CLEAR_LOGPOINT: {
      const removedIds = [];
      for (const [id, message] of messagesById) {
        if (message.logpointId == action.logpointId) {
          removedIds.push(id);
        }
      }

      return removeMessagesFromState(
        {
          ...state,
          removedLogpointIds: new Set([...state.removedLogpointIds, action.logpointId]),
        },
        removedIds
      );
    }

    case constants.MESSAGE_OPEN:
      const openState = { ...state };
      openState.messagesUiById = [...messagesUiById, action.id];
      const currMessage = messagesById.get(action.id);

      // If the message is a console.group/groupCollapsed or a warning group.
      if (isGroupType(currMessage.type) || isWarningGroup(currMessage)) {
        // We want to make its children visible
        const messagesToShow = [...messagesById].reduce((res, [id, message]) => {
          if (
            !visibleMessages.includes(message.id) &&
            ((isWarningGroup(currMessage) && !!getWarningGroupType(message)) ||
              (isGroupType(currMessage.type) &&
                getParentGroups(message.groupId, groupsById).includes(action.id))) &&
            getMessageVisibility(message, {
              messagesState: openState,
              filtersState,
              // We want to check if the message is in an open group
              // only if it is not a direct child of the group we're opening.
              checkGroup: message.groupId !== action.id,
            }).visible
          ) {
            res.push(id);
          }
          return res;
        }, []);

        // We can then insert the messages ids right after the one of the group.
        const insertIndex = visibleMessages.indexOf(action.id) + 1;
        openState.visibleMessages = [
          ...visibleMessages.slice(0, insertIndex),
          ...messagesToShow,
          ...visibleMessages.slice(insertIndex),
        ];
      }

      return openState;

    case constants.MESSAGE_CLOSE:
      const closeState = { ...state };
      const messageId = action.id;
      const index = closeState.messagesUiById.indexOf(messageId);
      closeState.messagesUiById.splice(index, 1);
      closeState.messagesUiById = [...closeState.messagesUiById];

      // If the message is a group
      if (isGroupType(messagesById.get(messageId).type)) {
        // Hide all its children, unless they're in a warningGroup.
        closeState.visibleMessages = visibleMessages.filter((id, i, arr) => {
          const message = messagesById.get(id);
          const warningGroupMessage = messagesById.get(getParentWarningGroupMessageId(message));

          // If the message is in a warning group, then we return its current visibility.
          if (shouldGroupWarningMessages(warningGroupMessage, closeState)) {
            return arr.includes(id);
          }

          const parentGroups = getParentGroups(message.groupId, groupsById);
          return parentGroups.includes(messageId) === false;
        });
      } else if (isWarningGroup(messagesById.get(messageId))) {
        // If the message was a warningGroup, we hide all the messages in the group.
        const groupMessages = closeState.warningGroupsById.get(messageId);
        closeState.visibleMessages = visibleMessages.filter(id => !groupMessages.includes(id));
      }
      return closeState;

    case constants.MESSAGE_UPDATE_PAYLOAD:
      return {
        ...state,
        messagesPayloadById: new Map(messagesPayloadById).set(action.id, action.data),
      };


    case constants.FILTER_TOGGLE:
    case constants.FILTER_TEXT_SET:
    case constants.FILTERS_CLEAR:
    case constants.DEFAULT_FILTERS_RESET:
      return setVisibleMessages({
        messagesState: state,
        filtersState,
      });
  }

  return state;
}


/**
 * Returns the new current group id given the previous current group and the groupsById
 * state property.
 *
 * @param {String} currentGroup: id of the current group
 * @param {Map} groupsById
 * @param {Array} ignoredIds: An array of ids which can't be the new current group.
 * @returns {String|null} The new current group id, or null if there isn't one.
 */
function getNewCurrentGroup(currentGroup, groupsById, ignoredIds = []) {
  if (!currentGroup) {
    return null;
  }

  // Retrieve the parent groups of the current group.
  const parents = groupsById.get(currentGroup);

  // If there's at least one parent, make the first one the new currentGroup.
  if (Array.isArray(parents) && parents.length > 0) {
    // If the found group must be ignored, let's search for its parent.
    if (ignoredIds.includes(parents[0])) {
      return getNewCurrentGroup(parents[0], groupsById, ignoredIds);
    }

    return parents[0];
  }

  return null;
}

function getParentGroups(currentGroup, groupsById) {
  let groups = [];
  if (currentGroup) {
    // If there is a current group, we add it as a parent
    groups = [currentGroup];

    // As well as all its parents, if it has some.
    const parentGroups = groupsById.get(currentGroup);
    if (Array.isArray(parentGroups) && parentGroups.length > 0) {
      groups = groups.concat(parentGroups);
    }
  }

  return groups;
}

function getOutermostGroup(message, groupsById) {
  const groups = getParentGroups(message.groupId, groupsById);
  if (groups.length === 0) {
    return null;
  }
  return groups[groups.length - 1];
}

/**
 * Remove all top level messages that exceeds message limit.
 * Also populate an array of all backend actors associated with these
 * messages so they can be released.
 */
function limitTopLevelMessageCount(newState) {
  let topLevelCount =
    newState.groupsById.size === 0 ? newState.messagesById.size : getToplevelMessageCount(newState);

  if (topLevelCount <= logLimit) {
    return newState;
  }

  const removedMessagesId = [];

  let cleaningGroup = false;
  for (const [id, message] of newState.messagesById) {
    // If we were cleaning a group and the current message does not have
    // a groupId, we're done cleaning.
    if (cleaningGroup === true && !message.groupId) {
      cleaningGroup = false;
    }

    // If we're not cleaning a group and the message count is below the logLimit,
    // we exit the loop.
    if (cleaningGroup === false && topLevelCount <= logLimit) {
      break;
    }

    // If we're not currently cleaning a group, and the current message is identified
    // as a group, set the cleaning flag to true.
    if (cleaningGroup === false && newState.groupsById.has(id)) {
      cleaningGroup = true;
    }

    if (!message.groupId) {
      topLevelCount--;
    }

    removedMessagesId.push(id);
  }

  return removeMessagesFromState(newState, removedMessagesId);
}

/**
 * Clean the properties for a given state object and an array of removed messages ids.
 * Be aware that this function MUTATE the `state` argument.
 *
 * @param {MessageState} state
 * @param {Array} removedMessagesIds
 * @returns {MessageState}
 */
function removeMessagesFromState(state, removedMessagesIds) {
  if (!Array.isArray(removedMessagesIds) || removedMessagesIds.length === 0) {
    return state;
  }

  const visibleMessages = [...state.visibleMessages];
  removedMessagesIds.forEach(id => {
    const index = visibleMessages.indexOf(id);
    if (index > -1) {
      visibleMessages.splice(index, 1);
    }
  });

  if (state.visibleMessages.length > visibleMessages.length) {
    state.visibleMessages = visibleMessages;
  }

  const isInRemovedId = id => removedMessagesIds.includes(id);
  const mapHasRemovedIdKey = map => removedMessagesIds.some(id => map.has(id));
  const objectHasRemovedIdKey = obj => Object.keys(obj).findIndex(isInRemovedId) !== -1;

  const cleanUpMap = map => {
    const clonedMap = new Map(map);
    removedMessagesIds.forEach(id => clonedMap.delete(id));
    return clonedMap;
  };
  const cleanUpObject = object =>
    [...Object.entries(object)].reduce((res, [id, value]) => {
      if (!isInRemovedId(id)) {
        res[id] = value;
      }
      return res;
    }, {});

  state.messagesById = cleanUpMap(state.messagesById);

  if (state.messagesUiById.find(isInRemovedId)) {
    state.messagesUiById = state.messagesUiById.filter(id => !isInRemovedId(id));
  }

  if (isInRemovedId(state.currentGroup)) {
    state.currentGroup = getNewCurrentGroup(
      state.currentGroup,
      state.groupsById,
      removedMessagesIds
    );
  }

  if (mapHasRemovedIdKey(state.messagesPayloadById)) {
    state.messagesPayloadById = cleanUpMap(state.messagesPayloadById);
  }
  if (mapHasRemovedIdKey(state.groupsById)) {
    state.groupsById = cleanUpMap(state.groupsById);
  }
  if (mapHasRemovedIdKey(state.groupsById)) {
    state.groupsById = cleanUpMap(state.groupsById);
  }

  return state;
}

/**
 * Returns total count of top level messages (those which are not
 * within a group).
 */
function getToplevelMessageCount(state) {
  let count = 0;
  state.messagesById.forEach(message => {
    if (!message.groupId) {
      count++;
    }
  });
  return count;
}


function getDefaultFiltersCounter() {
  const count = DEFAULT_FILTERS.reduce((res, filter) => {
    res[filter] = 0;
    return res;
  }, {});
  count.global = 0;
  return count;
}

// Make sure that message has an execution point which can be used for sorting
// if other messages with real execution points appear later.
function ensureExecutionPoint(state, newMessage) {
  if (newMessage.executionPoint) {
    assert("executionPointTime" in newMessage);
    return;
  }

  // Add a lastExecutionPoint property which will group messages evaluated during
  // the same replay pause point. When applicable, it will place the message immediately
  // after the last visible message in the group without an execution point when sorting.
  let point = { checkpoint: 0, progress: 0 },
    time = 0,
    messageCount = 1;
  if (state.pausedExecutionPoint) {
    point = state.pausedExecutionPoint;
    time = state.pausedExecutionPointTime;
    const lastMessage = getLastMessageWithPoint(state, point);
    if (lastMessage.lastExecutionPoint) {
      messageCount = lastMessage.lastExecutionPoint.messageCount + 1;
    }
  } else if (state.visibleMessages.length) {
    const lastId = state.visibleMessages[state.visibleMessages.length - 1];
    const lastMessage = state.messagesById.get(lastId);
    if (lastMessage.executionPoint) {
      // If the message is evaluated while we are not paused, we want
      // to make sure that those messages are placed immediately after the execution
      // point's message.
      point = lastMessage.executionPoint;
      time = lastMessage.executionPointTime;
      messageCount = 0;
    } else {
      point = lastMessage.lastExecutionPoint.point;
      time = lastMessage.lastExecutionPoint.time;
      messageCount = lastMessage.lastExecutionPoint.messageCount + 1;
    }
  }

  newMessage.lastExecutionPoint = { point, time, messageCount };
}

function getLastMessageWithPoint(state, point) {
  // Find all of the messageIds with no real execution point and the same progress
  // value as the given point.
  const filteredMessageId = state.visibleMessages.filter(function (p) {
    const currentMessage = state.messagesById.get(p);
    if (currentMessage.executionPoint) {
      return false;
    }

    return point.progress === currentMessage.lastExecutionPoint.point.progress;
  });

  const lastMessageId = filteredMessageId[filteredMessageId.length - 1];
  return state.messagesById.get(lastMessageId) || {};
}


/**
 * Returns if a given type of warning message should be grouped.
 *
 * @param {ConsoleMessage} warningGroupMessage
 * @param {MessageState} messagesState
 */
function shouldGroupWarningMessages(warningGroupMessage, messagesState) {
  // We group warning messages if there are at least 2 messages that could go in it.
  const warningGroup = messagesState.warningGroupsById.get(warningGroupMessage.id);
  if (!warningGroup || !Array.isArray(warningGroup)) {
    return false;
  }

  return warningGroup.length > 1;
}

exports.messages = messages;

// Export for testing purpose.
exports.ensureExecutionPoint = ensureExecutionPoint;
