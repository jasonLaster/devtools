import React from "react";
import { connect, ConnectedProps } from "react-redux";

import TranscriptItem from "./TranscriptItem";
import CommentThread from "ui/components/Comments/TranscriptComments/CommentThread";
const { getFilenameFromURL } = require("devtools/client/debugger/src/utils/sources-tree/getURL");
const { getTextAtLocation } = require("devtools/client/debugger/src/reducers/sources");
const { getFormattedTime } = require("ui/utils/timeline");
const { findClosestFunction } = require("devtools/client/debugger/src/utils/ast");
const { getSymbols } = require("devtools/client/debugger/src/reducers/ast");

import { UIState } from "ui/state";
import { Comment } from "ui/state/comments";

type PropsFromParent = {
  comment: Comment;
};
type NonEventTranscriptItemProps = PropsFromRedux & PropsFromParent;

// Transcript item component for displaying non-events from the recording.
//
// Non-events refer to points that aren't associated with an Event (e.g. Mouse Click)
// for which there is a comment or pending comment.

function NonEventTranscriptItem({
  comment,
  closestFunction,
  snippet,
}: NonEventTranscriptItemProps) {
  let icon = "location-marker";
  let label = "Point In Time";
  let type = "time";
  let secondaryLabel = getFormattedTime(comment.time) || "";
  let highlightSecondaryLabel = false;

  if (comment.sourceLocation) {
    const { sourceUrl, line } = comment.sourceLocation;
    const filename = getFilenameFromURL(sourceUrl);
    type = "code";
    icon = "document-text";
    label = closestFunction?.name || `${filename}:${line}`;
    secondaryLabel = snippet;
    highlightSecondaryLabel = true;
  }

  return (
    <TranscriptItem
      item={comment}
      icon={<div className={`img ${icon}`} />}
      label={label}
      type={type}
      secondaryLabel={secondaryLabel}
      highlightSecondaryLabel={highlightSecondaryLabel}
    >
      <CommentThread comment={comment} time={comment.time} />
    </TranscriptItem>
  );
}

const connector = connect(
  (state: UIState, { comment: { sourceLocation } }: PropsFromParent) => ({
    snippet: sourceLocation
      ? getTextAtLocation(state, sourceLocation.sourceId, sourceLocation) || ""
      : "",
    closestFunction: sourceLocation
      ? findClosestFunction(getSymbols(state, { id: sourceLocation?.sourceId }), sourceLocation)
      : null,
  }),
  {}
);
type PropsFromRedux = ConnectedProps<typeof connector>;
export default connector(NonEventTranscriptItem);
