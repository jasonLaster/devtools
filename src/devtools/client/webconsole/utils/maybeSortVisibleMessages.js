const { compareNumericStrings } = require("protocol/utils");
function messageExecutionPoint(state, id) {
    const message = state.messagesById.get(id);
    return message.executionPoint || message.lastExecutionPoint.point;
}

function messageCountSinceLastExecutionPoint(state, id) {
    const message = state.messagesById.get(id);
    return message.lastExecutionPoint ? message.lastExecutionPoint.messageCount : 0;
}

function getNaturalOrder(messageA, messageB) {
    const aFirst = -1;
    const bFirst = 1;

    // It can happen that messages are emitted in the same microsecond, making their
    // timestamp similar. In such case, we rely on which message came first through
    // the console API service, checking their id.
    if (
        messageA.timeStamp === messageB.timeStamp &&
        !Number.isNaN(parseInt(messageA.id, 10)) &&
        !Number.isNaN(parseInt(messageB.id, 10))
    ) {
        return parseInt(messageA.id, 10) < parseInt(messageB.id, 10) ? aFirst : bFirst;
    }
    return messageA.timeStamp < messageB.timeStamp ? aFirst : bFirst;
}

/**
 * Sort state.visibleMessages if needed.
 *
 * @param {MessageState} state
 * @param {Boolean} sortWarningGroupMessage: set to true to sort warningGroup
 *                                           messages. Default to false, as in some
 *                                           situations we already take care of putting
 *                                           the ids at the right position.
 * @param {Boolean} timeStampSort: set to true to sort messages by their timestamps.
 */
export function maybeSortVisibleMessages(state, sortWarningGroupMessage = false, timeStampSort = false) {
    // When using log points while replaying, messages can be added out of order
    // with respect to how they originally executed. Use the execution point
    // information in the messages to sort visible messages according to how
    // they originally executed. This isn't necessary if we haven't seen any
    // messages with execution points, as either we aren't replaying or haven't
    // seen any messages yet.
    if (state.hasExecutionPoints) {
        state.visibleMessages = [...state.visibleMessages].sort((a, b) => {
            const compared = compareNumericStrings(
                messageExecutionPoint(state, a),
                messageExecutionPoint(state, b)
            );
            if (compared < 0) {
                return -1;
            } else if (compared > 0) {
                return 1;
            } else {
                const _a = messageCountSinceLastExecutionPoint(state, a);
                const _b = messageCountSinceLastExecutionPoint(state, b);
                return _a < _b ? -1 : _a > _b ? 1 : 0;
            }
        });
    }

    if (state.warningGroupsById.size > 0 && sortWarningGroupMessage) {
        state.visibleMessages.sort((a, b) => {
            const messageA = state.messagesById.get(a);
            const messageB = state.messagesById.get(b);

            const warningGroupIdA = getParentWarningGroupMessageId(messageA);
            const warningGroupIdB = getParentWarningGroupMessageId(messageB);

            const warningGroupA = state.messagesById.get(warningGroupIdA);
            const warningGroupB = state.messagesById.get(warningGroupIdB);

            const aFirst = -1;
            const bFirst = 1;

            // If both messages are in a warningGroup, or if both are not in warningGroups.
            if ((warningGroupA && warningGroupB) || (!warningGroupA && !warningGroupB)) {
                return getNaturalOrder(messageA, messageB);
            }

            // If `a` is in a warningGroup (and `b` isn't).
            if (warningGroupA) {
                // If `b` is the warningGroup of `a`, `a` should be after `b`.
                if (warningGroupIdA === messageB.id) {
                    return bFirst;
                }
                // `b` is a regular message, we place `a` before `b` if `b` came after `a`'s
                // warningGroup.
                return getNaturalOrder(warningGroupA, messageB);
            }

            // If `b` is in a warningGroup (and `a` isn't).
            if (warningGroupB) {
                // If `a` is the warningGroup of `b`, `a` should be before `b`.
                if (warningGroupIdB === messageA.id) {
                    return aFirst;
                }
                // `a` is a regular message, we place `a` after `b` if `a` came after `b`'s
                // warningGroup.
                return getNaturalOrder(messageA, warningGroupB);
            }

            return 0;
        });
    }

    if (timeStampSort) {
        state.visibleMessages.sort((a, b) => {
            const messageA = state.messagesById.get(a);
            const messageB = state.messagesById.get(b);

            return messageA.timeStamp < messageB.timeStamp ? -1 : 1;
        });
    }
}