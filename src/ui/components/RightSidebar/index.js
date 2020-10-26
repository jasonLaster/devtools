import React, { useState } from "react";
import ReactDOM from "react-dom";
import EventsTimeline from "./EventsTimeline";
import Intercom from "./Intercom";
import EventListeners from "devtools/client/debugger/src/components/SecondaryPanes/EventListeners";

import "./RightSidebar.css";
import { set } from "lodash";

function Buttons({ setExpanded, expanded, popup, setPopup }) {
  const [commentButtonNode, setCommentButtonNode] = useState(null);
  const [eventButtonNode, setEventButtonNode] = useState(null);
  const [nextAction, setNextAction] = useState(null);

  const handleMouseEnter = (node, name) => {
    const target = node;
    const id = setTimeout(() => {
      setPopup({ name, targetNode: target.getBoundingClientRect() });
    }, 200);

    clearTimeout(nextAction);
    setNextAction(id);
  };
  const handleMouseLeave = e => {
    const id = setTimeout(() => {
      setPopup(null);
    }, 200);

    clearTimeout(nextAction);
    setNextAction(id);
  };

  return (
    <div className="buttons">
      <button
        className="drawer-comments"
        onClick={() => setExpanded(expanded === "comments" ? null : "comments")}
        ref={node => setCommentButtonNode(node)}
        onMouseEnter={() => handleMouseEnter(commentButtonNode, "Comments")}
        onMouseLeave={handleMouseLeave}
      >
        <div className="img comment-icon"></div>
      </button>
      <button
        className="drawer-event-logpoints"
        onClick={() => setExpanded(expanded === "events" ? null : "events")}
        ref={node => setEventButtonNode(node)}
        onMouseEnter={() => handleMouseEnter(eventButtonNode, "Event Logpoints")}
        onMouseLeave={handleMouseLeave}
      >
        <div className="img lightning"></div>
      </button>
    </div>
  );
}

function Popup({ popup, drawerNode }) {
  const top = popup.targetNode.top - drawerNode.getBoundingClientRect().top;

  return (
    <div className="popup" style={{ top: top }}>
      {popup.name}
    </div>
  );
}

function Drawer({ setExpanded, expanded }) {
  const [popup, setPopup] = useState(null);
  const [drawerNode, setDrawerNode] = useState(null);

  return (
    <div className="drawer" ref={node => setDrawerNode(node)}>
      {popup ? <Popup popup={popup} drawerNode={drawerNode} /> : null}
      <Buttons setExpanded={setExpanded} expanded={expanded} popup={popup} setPopup={setPopup} />
    </div>
  );
}

export default function RightSidebar({}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="right-sidebar">
      {expanded === "comments" && <EventsTimeline expanded={expanded} />}
      {expanded === "events" && <EventListeners />}
      <Drawer setExpanded={setExpanded} expanded={expanded} />
    </div>
  );
}
