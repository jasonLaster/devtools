/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

import SourceEditor from "./source-editor";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
// eslint-disable-next-line max-len
import { StaticServices } from "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices";
import { isWasm, getWasmLineNumberFormatter } from "../wasm";

const models = {};

function getDocument(key) {
  return models[key];
}

function hasDocument(key) {
  return !!getDocument(key);
}

function setDocument(key, doc) {
  models[key] = doc;
}

function removeDocument(key) {
  delete models[key];
}

function clearDocuments() {
  models = {};
}

function resetLineNumberFormat(editor) {
  editor.monaco.updateOptions({
    lineNumbers: num => num,
  });
}

function updateLineNumberFormat(editor, sourceId) {
  if (!isWasm(sourceId)) {
    return resetLineNumberFormat(editor);
  }
  const lineNumberFormatter = getWasmLineNumberFormatter(sourceId);
  editor.monaco.updateOptions({
    lineNumbers: lineNumberFormatter,
  });
}

function createModel(value, language, uri, isForSimpleWidget) {
  return StaticServices.modelService
    .get()
    .createModel(value, StaticServices.modeService.get().getOrCreateMode(language), uri, true);
}

function updateDocument(editor, source) {
  if (!source) {
    return;
  }

  const sourceId = source.id;
  const doc = getDocument(sourceId) || createModel("", "plaintext", null, true);
  editor.replaceDocument(doc);

  updateLineNumberFormat(editor, sourceId);
}

function clearEditor(editor) {
  const doc = createModel("", "plaintext", null, true);
  editor.replaceDocument(doc);
  resetLineNumberFormat(editor);
}

function showSourceText(editor, source) {
  if (!source) {
    return;
  }

  const { text, id: sourceId } = source;

  if (hasDocument(sourceId)) {
    const doc = getDocument(sourceId);
    if (editor.monaco.getModel() === doc) {
      return;
    }

    editor.replaceDocument(doc);
    updateLineNumberFormat(editor, sourceId);
    return doc;
  }

  // workaround: avoid guessIndentation for large content.
  const doc = createModel("", "javascript", null, true);
  doc.setValue(text);
  setDocument(sourceId, doc);
  editor.replaceDocument(doc);
  updateLineNumberFormat(editor, sourceId);
}

function showErrorMessage(editor, msg) {
  let error;
  if (msg.includes("WebAssembly binary source is not available")) {
    error = L10N.getStr("wasmIsNotAvailable");
  } else {
    error = L10N.getFormatStr("errorLoadingText3", msg);
  }
  const doc = createModel(error, "plaintext", null, true);
  editor.replaceDocument(doc);
  //   resetLineNumberFormat(editor);
}

function showLoading(editor) {
  if (hasDocument("loading")) {
    return;
  }

  const doc = monaco.editor.createModel(L10N.getStr("loadingText"), "plaintext");
  setDocument("loading", doc);
  editor.replaceDocument(doc);
}

export {
  getDocument,
  setDocument,
  hasDocument,
  removeDocument,
  clearDocuments,
  updateLineNumberFormat,
  updateDocument,
  clearEditor,
  showSourceText,
  showErrorMessage,
  showLoading,
};
