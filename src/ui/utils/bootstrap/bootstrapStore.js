import { prefs, asyncStore } from "../prefs";
import { combineReducers, applyMiddleware } from "redux";
import { reducers, selectors } from "../../reducers";
import { setupAppHelper } from "./helpers";
import configureStore from "devtools/client/debugger/src/actions/utils/create-store";
import { clientCommands } from "devtools/client/debugger/src/client/commands";
import LogRocket from "ui/utils/logrocket";
import * as dbgClient from "devtools/client/debugger/src/client";
import { bootstrapWorkers } from "devtools/client/debugger/src/utils/bootstrap";

async function getInitialState() {
  const eventListenerBreakpoints = await asyncStore.eventListenerBreakpoints;
  const initialDebuggerState = await dbgClient.loadInitialState();

  return {
    ...initialDebuggerState,
    eventListenerBreakpoints,
  };
}

function registerStoreObserver(store, subscriber) {
  let oldState = store.getState();
  store.subscribe(() => {
    const state = store.getState();
    subscriber(state, oldState);
    oldState = state;
  });
}

function updatePrefs(state, oldState) {
  function updatePref(field, selector) {
    if (selector(state) != selector(oldState)) {
      prefs[field] = selector(state);
    }
  }
  function updateAsyncPref(field, selector) {
    if (selector(state) != selector(oldState)) {
      asyncStore[field] = selector(state);
    }
  }

  updatePref("isToolboxOpen", selectors.isToolboxOpen);
  updatePref("splitConsole", selectors.isSplitConsoleOpen);
  updatePref("user", selectors.getUser);
  updatePref("selectedPanel", selectors.getSelectedPanel);
  updateAsyncPref("eventListenerBreakpoints", state => state.eventListenerBreakpoints);
}

export const bootstrapStore = async function bootstrapStore(skipTelemetry) {
  const debuggerWorkers = bootstrapWorkers();

  // TODO; manage panels outside of the Toolbox componenet
  const panels = {};

  const createStore = configureStore({
    makeThunkArgs: args => {
      return { ...args, client: clientCommands, ...debuggerWorkers, panels };
    },
  });

  const initialState = await getInitialState();
  const middleware = skipTelemetry ? undefined : applyMiddleware(LogRocket.reduxMiddleware());

  const store = createStore(combineReducers(reducers), initialState, middleware);

  dbgClient.bootstrap(store);

  registerStoreObserver(store, updatePrefs);

  setupAppHelper(store);

  return store;
};
