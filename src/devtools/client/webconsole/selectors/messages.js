/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { getWarningGroupType } = require("devtools/client/webconsole/utils/messages");
const { getParentWarningGroupMessageId } = require("devtools/client/webconsole/utils/messages");

function getAllMessagesById(state) {
  return state.messages.messagesById;
}

function getMessage(state, id) {
  return getAllMessagesById(state).get(id);
}

function getAllMessagesUiById(state) {
  return state.messages.messagesUiById;
}
function getAllMessagesPayloadById(state) {
  return state.messages.messagesPayloadById;
}

function getAllGroupsById(state) {
  return state.messages.groupsById;
}

function getCurrentGroup(state) {
  return state.messages.currentGroup;
}

function getVisibleMessages(state) {
  return state.messages.visibleMessages;
}

function getFilteredMessagesCount(state) {
  return state.messages.filteredMessagesCount;
}

function getAllRepeatById(state) {
  return state.messages.repeatById;
}

function getGroupsById(state) {
  return state.messages.groupsById;
}

function getPausedExecutionPoint(state) {
  return state.messages.pausedExecutionPoint;
}

function getPausedExecutionPointTime(state) {
  return state.messages.pausedExecutionPointTime;
}

function getAllWarningGroupsById(state) {
  return state.messages.warningGroupsById;
}

function isMessageInWarningGroup(message, visibleMessages = []) {
  if (!getWarningGroupType(message)) {
    return false;
  }

  return visibleMessages.includes(getParentWarningGroupMessageId(message));
}

module.exports = {
  getAllGroupsById,
  getAllWarningGroupsById,
  getAllMessagesById,
  getAllMessagesPayloadById,
  getAllMessagesUiById,
  getAllRepeatById,
  getCurrentGroup,
  getFilteredMessagesCount,
  getGroupsById,
  getMessage,
  getVisibleMessages,
  getPausedExecutionPoint,
  getPausedExecutionPointTime,
  isMessageInWarningGroup,
};
