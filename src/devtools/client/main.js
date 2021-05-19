const url = new URL(window.location.href);

// Coercing recordingId to undefined so that it is not passed to auth0
const recordingId = url.searchParams.get("id") || undefined;
const dispatch = url.searchParams.get("dispatch");
const test = url.searchParams.get("test");

// During testing, make sure we clear local storage before importing
// any code that might instantiate preferences from local storage.
if (test) {
  localStorage.clear();
  require("devtools-modules").asyncStorage.clear();
}

// *** WARNING ***
//
// Do not use "import" in this file. The import will run before we clear
// the local storage above, and existing local storage contents may be used
// when running automated tests, which we don't want to happen. It would
// be good if this was less fragile...
//

const { initSocket } = require("protocol/socket");
const { setupLogpoints } = require("./protocol/logpoint");
const { setupTimeline, setupApp } = require("ui/actions").actions;
const { setupGraphics } = require("protocol/graphics");
const { setupMessages } = require("devtools/client/webconsole/actions/messages");

const { LocalizationHelper } = require("devtools/shared/l10n");
const { setupEventListeners } = require("devtools/client/debugger/src/actions/event-listeners");
const { createSession } = require("ui/actions/session");
const {
  initOutputSyntaxHighlighting,
} = require("./devtools/client/webconsole/utils/syntax-highlighted");
const { setupExceptions } = require("devtools/client/debugger/src/actions/logExceptions");
const { selectors } = require("ui/reducers");

const { bootstrapStore } = require("ui/utils/bootstrap/bootstrapStore");
const { DevToolsToolbox } = require("ui/utils/devtools-toolbox");

let initialized = false;

export async function initializeDevTools(store) {
  window.gToolbox = new DevToolsToolbox();
  store = await bootstrapStore();

  const theme = selectors.getTheme(store.getState());
  document.body.parentElement.className = theme || "";

  if (recordingId) {
    setupApp(recordingId, store);
    setupTimeline(recordingId, store);
    setupEventListeners(recordingId, store);
    setupGraphics(store);
    initOutputSyntaxHighlighting();
    setupMessages(store);
    setupLogpoints(store);
    setupExceptions(store);
  }

  window.L10N = new LocalizationHelper("devtools/client/locales/debugger.properties");

  // Initialize the socket so we can communicate with the server
  initSocket(store, dispatch);

  if (recordingId) {
    createSession(store, recordingId);
  }

  document.body.addEventListener("contextmenu", e => e.preventDefault());

  // Set the current mouse position on the window. This is used in places where
  // testing element.matches(":hover") does not work right for some reason.
  document.body.addEventListener("mousemove", e => {
    window.mouseClientX = e.clientX;
    window.mouseClientY = e.clientY;
  });
  window.elementIsHovered = elem => {
    if (!elem) {
      return false;
    }
    const { left, top, right, bottom } = elem.getBoundingClientRect();
    const { mouseClientX, mouseClientY } = window;
    return (
      left <= mouseClientX && mouseClientX <= right && top <= mouseClientY && mouseClientY <= bottom
    );
  };
}
