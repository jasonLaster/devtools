const { getGripPreviewItems } = require("devtools/client/debugger/packages/devtools-reps/src");
const { getUnicodeUrlPath } = require("devtools/client/shared/unicode-url");
const { getSourceNames } = require("devtools/client/shared/source-utils");
const {
  isWarningGroup,
  getParentWarningGroupMessageId,
} = require("devtools/client/webconsole/utils/messages");
const { MESSAGE_TYPE, MESSAGE_SOURCE, FILTERS } = require("devtools/client/webconsole/constants");
const { maybeSortVisibleMessages } = require("devtools/client/webconsole/utils/maybeSortVisibleMessages")

function isUnfilterable(message) {
  return [
    MESSAGE_TYPE.COMMAND,
    MESSAGE_TYPE.RESULT,
    MESSAGE_TYPE.START_GROUP,
    MESSAGE_TYPE.START_GROUP_COLLAPSED,
    MESSAGE_TYPE.NAVIGATION_MARKER,
  ].includes(message.type);
}

function isInOpenedGroup(message, groupsById, messagesUI) {
  return (
    !message.groupId ||
    (!isGroupClosed(message.groupId, messagesUI) &&
      !hasClosedParentGroup(groupsById.get(message.groupId), messagesUI))
  );
}

function hasClosedParentGroup(group, messagesUI) {
  return group.some(groupId => isGroupClosed(groupId, messagesUI));
}

function isGroupClosed(groupId, messagesUI) {
  return messagesUI.includes(groupId) === false;
}

/**
 * Returns true if the message is in node modules and should be hidden
 *
 * @param {Object} message - The message to check the filter against.
 * @param {FilterState} filters - redux "filters" state.
 * @returns {Boolean}
 */
function passNodeModuleFilters(message, filters) {
  return message.frame?.source?.includes("node_modules") && filters[FILTERS.NODEMODULES] == false;
}

/**
 * Returns true if the message shouldn't be hidden because of levels filter state.
 *
 * @param {Object} message - The message to check the filter against.
 * @param {FilterState} filters - redux "filters" state.
 * @returns {Boolean}
 */
function passLevelFilters(message, filters) {
  // The message passes the filter if it is not a console call,
  // or if its level matches the state of the corresponding filter.
  return (
    (message.source !== MESSAGE_SOURCE.CONSOLE_API &&
      message.source !== MESSAGE_SOURCE.JAVASCRIPT) ||
    filters[message.level] === true
  );
}

/**
 * Returns true if the message shouldn't be hidden because of search filter state.
 *
 * @param {Object} message - The message to check the filter against.
 * @param {FilterState} filters - redux "filters" state.
 * @returns {Boolean}
 */
function passSearchFilters(message, filters) {
  const trimmed = (filters.text || "").trim().toLocaleLowerCase();

  // "-"-prefix switched to exclude mode
  const exclude = trimmed.startsWith("-");
  const term = exclude ? trimmed.slice(1) : trimmed;

  let regex;
  if (term.startsWith("/") && term.endsWith("/") && term.length > 2) {
    try {
      regex = new RegExp(term.slice(1, -1), "im");
    } catch (e) { }
  }
  const matchStr = regex ? str => regex.test(str) : str => str.toLocaleLowerCase().includes(term);

  // If there is no search, the message passes the filter.
  if (!term) {
    return true;
  }

  const matched =
    // Look for a match in parameters.
    isTextInParameters(matchStr, message.parameters) ||
    // Look for a match in location.
    isTextInFrame(matchStr, message.frame) ||
    // Look for a match in net events.
    isTextInNetEvent(matchStr, message.request) ||
    // Look for a match in stack-trace.
    isTextInStackTrace(matchStr, message.stacktrace) ||
    // Look for a match in messageText.
    isTextInMessageText(matchStr, message.messageText) ||
    // Look for a match in notes.
    isTextInNotes(matchStr, message.notes) ||
    // Look for a match in prefix.
    isTextInPrefix(matchStr, message.prefix);

  return matched ? !exclude : exclude;
}


/**
 * Returns true if given text is included in provided stack frame.
 */
function isTextInFrame(matchStr, frame) {
  if (!frame) {
    return false;
  }

  const { functionName, line, column, source } = frame;
  const { short } = getSourceNames(source);
  const unicodeShort = getUnicodeUrlPath(short);

  const str = `${functionName ? functionName + " " : ""}${unicodeShort}:${line}:${column}`;
  return matchStr(str);
}

/**
 * Returns true if given text is included in provided parameters.
 */
function isTextInParameters(matchStr, parameters) {
  if (!parameters) {
    return false;
  }

  return parameters.some(parameter => isTextInParameter(matchStr, parameter));
}

/**
 * Returns true if given text is included in provided parameter.
 */
function isTextInParameter(matchStr, parameter) {
  if (parameter.isPrimitive()) {
    return matchStr(String(parameter.primitive()));
  }

  if (!parameter.isObject()) {
    return false;
  }

  if (matchStr(parameter.className())) {
    return true;
  }

  const previewItems = getGripPreviewItems(parameter);
  for (const item of previewItems) {
    if (isTextInParameter(matchStr, item)) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if given text is included in provided net event grip.
 */
function isTextInNetEvent(matchStr, request) {
  if (!request) {
    return false;
  }

  const method = request.method;
  const url = request.url;
  return matchStr(method) || matchStr(url);
}

/**
 * Returns true if given text is included in provided stack trace.
 */
function isTextInStackTrace(matchStr, stacktrace) {
  if (!Array.isArray(stacktrace)) {
    return false;
  }

  // isTextInFrame expect the properties of the frame object to be in the same
  // order they are rendered in the Frame component.
  return stacktrace.some(frame =>
    isTextInFrame(matchStr, {
      functionName: frame.functionName || l10n.getStr("stacktrace.anonymousFunction"),
      source: frame.filename,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
    })
  );
}

/**
 * Returns true if given text is included in `messageText` field.
 */
function isTextInMessageText(matchStr, messageText) {
  if (!messageText) {
    return false;
  }

  if (typeof messageText === "string") {
    return matchStr(messageText);
  }

  const grip = messageText && messageText.getGrip ? messageText.getGrip() : messageText;
  if (grip && grip.type === "longString") {
    return matchStr(grip.initial);
  }

  return true;
}

/**
 * Returns true if given text is included in notes.
 */
function isTextInNotes(matchStr, notes) {
  if (!Array.isArray(notes)) {
    return false;
  }

  return notes.some(
    note =>
      // Look for a match in location.
      isTextInFrame(matchStr, note.frame) ||
      // Look for a match in messageBody.
      (note.messageBody && matchStr(note.messageBody))
  );
}

/**
 * Returns true if given text is included in prefix.
 */
function isTextInPrefix(matchStr, prefix) {
  if (!prefix) {
    return false;
  }

  return matchStr(`${prefix}: `);
}

/**
 * Check if a message should be visible in the console output, and if not, what
 * causes it to be hidden.
 * @param {Message} message: The message to check
 * @param {Object} option: An option object of the following shape:
 *                   - {MessageState} messagesState: The current messages state
 *                   - {FilterState} filtersState: The current filters state
 *                   - {Boolean} checkGroup: Set to false to not check if a message should
 *                                 be visible because it is in a console.group.
 *                   - {Boolean} checkParentWarningGroupVisibility: Set to false to not
 *                                 check if a message should be visible because it is in a
 *                                 warningGroup and the warningGroup is visible.
 *
 * @return {Object} An object of the following form:
 *         - visible {Boolean}: true if the message should be visible
 *         - cause {String}: if visible is false, what causes the message to be hidden.
 */
// eslint-disable-next-line complexity
export function getMessageVisibility(
  message,
  { messagesState, filtersState, checkGroup = true, checkParentWarningGroupVisibility = true }
) {
  const warningGroupMessageId = getParentWarningGroupMessageId(message);
  const parentWarningGroupMessage = messagesState.messagesById.get(warningGroupMessageId);

  // Do not display the message if it's in closed group and not in a warning group.
  if (
    checkGroup &&
    !isInOpenedGroup(message, messagesState.groupsById, messagesState.messagesUiById) &&
    !shouldGroupWarningMessages(parentWarningGroupMessage, messagesState)
  ) {
    return {
      visible: false,
      cause: "closedGroup",
    };
  }

  // If the message is a warningGroup, check if it should be displayed.
  if (isWarningGroup(message)) {
    if (!shouldGroupWarningMessages(message, messagesState)) {
      return {
        visible: false,
        cause: "warningGroupHeuristicNotMet",
      };
    }

    // Hide a warningGroup if the warning filter is off.
    if (!filtersState[FILTERS.WARN]) {
      // We don't include any cause as we don't want that message to be reflected in the
      // message count.
      return {
        visible: false,
      };
    }

    // Display a warningGroup if at least one of its message will be visible.
    const childrenMessages = messagesState.warningGroupsById.get(message.id);
    const hasVisibleChild =
      childrenMessages &&
      childrenMessages.some(id => {
        const child = messagesState.messagesById.get(id);
        if (!child) {
          return false;
        }

        const { visible, cause } = getMessageVisibility(child, {
          messagesState,
          filtersState,
          checkParentWarningGroupVisibility: false,
        });
        return visible && cause !== "visibleWarningGroup";
      });

    if (hasVisibleChild) {
      return {
        visible: true,
        cause: "visibleChild",
      };
    }
  }

  // Do not display the message if it can be in a warningGroup, and the group is
  // displayed but collapsed.
  if (
    parentWarningGroupMessage &&
    shouldGroupWarningMessages(parentWarningGroupMessage, messagesState) &&
    !messagesState.messagesUiById.includes(warningGroupMessageId)
  ) {
    return {
      visible: false,
      cause: "closedWarningGroup",
    };
  }

  // Display a message if it is in a warningGroup that is visible. We don't check the
  // warningGroup visibility if `checkParentWarningGroupVisibility` is false, because
  // it means we're checking the warningGroup visibility based on the visibility of its
  // children, which would cause an infinite loop.
  const parentVisibility =
    parentWarningGroupMessage && checkParentWarningGroupVisibility
      ? getMessageVisibility(parentWarningGroupMessage, {
        messagesState,
        filtersState,
        checkGroup,
        checkParentWarningGroupVisibility,
      })
      : null;
  if (parentVisibility && parentVisibility.visible && parentVisibility.cause !== "visibleChild") {
    return {
      visible: true,
      cause: "visibleWarningGroup",
    };
  }

  // Some messages can't be filtered out (e.g. groups).
  // So, always return visible: true for those.
  if (isUnfilterable(message)) {
    return {
      visible: true,
    };
  }

  // Let's check all level filters (error, warn, log, …) and return visible: false
  // and the message level as a cause if the function returns false.
  if (!passLevelFilters(message, filtersState)) {
    return {
      visible: false,
      cause: message.level,
    };
  }

  if (passNodeModuleFilters(message, filtersState)) {
    return {
      visible: false,
      cause: FILTERS.NODEMODULES,
    };
  }

  // This should always be the last check, or we might report that a message was hidden
  // because of text search, while it may be hidden because its category is disabled.
  if (!passSearchFilters(message, filtersState)) {
    return {
      visible: false,
      cause: FILTERS.TEXT,
    };
  }

  return {
    visible: true,
  };
}


export function setVisibleMessages({ messagesState, filtersState, forceTimestampSort = false }) {
  const { messagesById } = messagesState;

  const messagesToShow = [];
  const filtered = getDefaultFiltersCounter();

  messagesById.forEach((message, msgId) => {
    const { visible, cause } = getMessageVisibility(message, {
      messagesState,
      filtersState,
    });

    if (visible) {
      messagesToShow.push(msgId);
    } else if (DEFAULT_FILTERS.includes(cause)) {
      filtered.global = filtered.global + 1;
      filtered[cause] = filtered[cause] + 1;
    }
  });

  const newState = {
    ...messagesState,
    visibleMessages: messagesToShow,
    filteredMessagesCount: filtered,
  };

  maybeSortVisibleMessages(
    newState,
    // Only sort for warningGroups if the feature is enabled
    forceTimestampSort
  );

  return newState;
}