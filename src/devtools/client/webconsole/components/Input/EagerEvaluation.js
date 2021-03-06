/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Component } = require("react");
const dom = require("react-dom-factories");
const { connect } = require("react-redux");

const { getTerminalEagerResult } = require("devtools/client/webconsole/selectors/history");

const actions = require("devtools/client/webconsole/actions/index");

/*
loader.lazyGetter(this, "REPS", function() {
  return require("devtools/client/debugger/packages/devtools-reps/src").REPS;
});
loader.lazyGetter(this, "MODE", function() {
  return require("devtools/client/debugger/packages/devtools-reps/src").MODE;
});
*/

const PropTypes = require("prop-types");

/**
 * Show the results of evaluating the current terminal text, if possible.
 */
class EagerEvaluation extends Component {
  static get propTypes() {
    return {
      terminalEagerResult: PropTypes.any,
      highlightDomElement: PropTypes.func.isRequired,
      unHighlightDomElement: PropTypes.func.isRequired,
    };
  }

  componentDidUpdate(prevProps) {
    const { highlightDomElement, unHighlightDomElement, terminalEagerResult } = this.props;

    if (canHighlightObject(prevProps.terminalEagerResult)) {
      unHighlightDomElement(prevProps.terminalEagerResult.getGrip());
    }

    if (canHighlightObject(terminalEagerResult)) {
      highlightDomElement(terminalEagerResult.getGrip());
    }
  }

  componentWillUnmount() {
    const { unHighlightDomElement, terminalEagerResult } = this.props;

    if (canHighlightObject(terminalEagerResult)) {
      unHighlightDomElement(terminalEagerResult.getGrip());
    }
  }

  renderRepsResult() {
    const { terminalEagerResult } = this.props;

    const result = terminalEagerResult.getGrip
      ? terminalEagerResult.getGrip()
      : terminalEagerResult;
    const isError = result && result.class && result.class === "Error";

    return REPS.Rep({
      key: "rep",
      object: result,
      mode: isError ? MODE.SHORT : MODE.LONG,
    });
  }

  render() {
    const hasResult = this.props.terminalEagerResult !== null;

    return dom.div(
      { className: "eager-evaluation-result", key: "eager-evaluation-result" },
      hasResult
        ? dom.span(
            { className: "eager-evaluation-result__row" },
            dom.span({
              className: "eager-evaluation-result__icon",
              key: "icon",
            }),
            dom.span(
              { className: "eager-evaluation-result__text", key: "text" },
              this.renderRepsResult()
            )
          )
        : null
    );
  }
}

function canHighlightObject(obj) {
  const grip = obj && obj.getGrip && obj.getGrip();
  return (
    grip &&
    (REPS.ElementNode.supportsObject(grip) || REPS.TextNode.supportsObject(grip)) &&
    grip.preview.isConnected
  );
}

function mapStateToProps(state) {
  return {
    terminalEagerResult: getTerminalEagerResult(state),
  };
}

function mapDispatchToProps(dispatch) {
  return {
    highlightDomElement: grip => dispatch(actions.highlightDomElement(grip)),
    unHighlightDomElement: grip => dispatch(actions.unHighlightDomElement(grip)),
  };
}
module.exports = connect(mapStateToProps, mapDispatchToProps)(EagerEvaluation);
