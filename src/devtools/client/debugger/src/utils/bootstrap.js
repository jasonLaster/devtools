/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import * as search from "../workers/search";
import { ParserDispatcher } from "../workers/parser";

import * as selectors from "../selectors";
import { asyncStore } from "./prefs";
import { persistTabs } from "../utils/tabs";

let parser;

export function bootstrapWorkers(panelWorkers) {
  const workerPath = "dist";

  parser = new ParserDispatcher();

  parser.start(`${workerPath}/parserWorker.js`);
  search.start(`${workerPath}/searchWorker.js`);
  return { ...panelWorkers, parser, search };
}

export function teardownWorkers() {
  parser.stop();
  search.stop();
}

let currentPendingBreakpoints;
let currentTabs;

export function updatePrefs(state) {
  const previousPendingBreakpoints = currentPendingBreakpoints;
  const previousTabs = currentTabs;
  currentPendingBreakpoints = selectors.getPendingBreakpoints(state);
  currentTabs = selectors.getTabs(state);

  if (previousPendingBreakpoints && currentPendingBreakpoints !== previousPendingBreakpoints) {
    asyncStore.pendingBreakpoints = currentPendingBreakpoints;
  }

  if (previousTabs && previousTabs !== currentTabs) {
    asyncStore.tabs = persistTabs(currentTabs);
  }
}
