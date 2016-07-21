/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

import {traverse} from 'estraverse';
import {Program, Node} from 'estree';

import {Document} from './document';
import {Visitor} from '../ast-utils/fluent-traverse';
export {Visitor} from '../ast-utils/fluent-traverse';

export class JavaScriptDocument extends Document<Program, Visitor> {
  type = 'js';

  visit(visitors: Visitor[]) {

    /**
     * Applies all visiting callbacks from `visitors`.
     */
    function applyFinders(callbackName: string, node: Node, parent: Node) {
      for (let visitor of visitors) {
        let callback = visitor[callbackName];
        if (callback) {
          return callback(node, parent) || undefined;
        }
      }
    }

    traverse(<Node><any>this.ast, {
      enter(node, parent) {
        return applyFinders(`enter ${node.type}`, node, parent);
      },
      leave(node, parent) {
        return applyFinders(`leave ${node.type}`, node, parent);
      },
      fallback: 'iteration',
    });
  }
}
