import { declare } from '@babel/helper-plugin-utils';
import * as t from '@babel/types';
import {
  removeStyleDeclarations,
  isCCComponent,
  isCreateElement,
  isAutomaticRuntime,
} from './utils/ast';
import type { PluginPass } from './types';
import type { NodePath } from '@babel/traverse';

export default declare<PluginPass>((api) => {
  api.assertVersion(7);

  return {
    name: '@compiled/babel-plugin-strip-runtime',
    pre() {
      this.styleRules = [];
      this.removed = new Set();
    },
    visitor: {
      Program: {
        exit() {
          if (this.opts.onFoundStyleRules) {
            this.opts.onFoundStyleRules(this.styleRules);
          }
        },
      },
      ImportSpecifier(path) {
        if (t.isIdentifier(path.node.imported) && ['CC', 'CS'].includes(path.node.imported.name)) {
          this.removed.add(path.node.local.name);
          path.remove();
        }
      },
      JSXElement(path, pass) {
        if (!t.isJSXIdentifier(path.node.openingElement.name)) {
          return;
        }

        const componentName = path.node.openingElement.name.name;
        if (componentName !== 'CC') {
          return;
        }

        const [, compiledStyles, , nodeToReplace] = path.get('children');

        // Before we replace this node with its children we need to go through and remove all the
        // style declarations from the CS call.
        removeStyleDeclarations(compiledStyles.node, path, pass);

        if (t.isJSXExpressionContainer(nodeToReplace.node)) {
          const container = nodeToReplace as NodePath<t.JSXExpressionContainer>;
          path.replaceWith(container.node.expression);
        } else {
          path.replaceWith(nodeToReplace);
        }

        // All done! Let's replace this node with the user land child.
        path.node.leadingComments = null;
        return;
      },
      CallExpression(path, pass) {
        const callee = path.node.callee;
        if (isCreateElement(callee)) {
          // We've found something that looks like React.createElement(...)
          // Now we want to check if it's from the Compiled Runtime and if it is - replace with its children.
          const component = path.node.arguments[0];
          if (!isCCComponent(component, this.removed)) {
            return;
          }

          const [, , compiledStyles, nodeToReplace] = path.get('arguments');

          // Before we replace this node with its children we need to go through and remove all the
          // style declarations from the CS call.
          removeStyleDeclarations(compiledStyles.node, path, pass);

          // All done! Let's replace this node with the user land child.
          path.replaceWith(nodeToReplace);
          path.node.leadingComments = null;
          return;
        }

        if (isAutomaticRuntime(path.node, 'jsxs')) {
          // We've found something that looks like _jsxs(...)
          // Now we want to check if it's from the Compiled Runtime and if it is - replace with its children.
          const component = path.node.arguments[0];
          if (!isCCComponent(component, this.removed)) {
            return;
          }

          const [, props] = path.get('arguments');
          if (!t.isObjectExpression(props.node)) {
            return;
          }

          const children = props.node.properties.find((prop): prop is t.ObjectProperty => {
            return (
              t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.key.name === 'children'
            );
          });

          if (!children || !t.isArrayExpression(children.value)) {
            return;
          }

          const [compiledStyles, nodeToReplace] = children.value.elements;
          if (!t.isExpression(nodeToReplace) || !t.isExpression(compiledStyles)) {
            throw new Error('Nodes should be expressions.');
          }

          // Before we replace this node with its children we need to go through and remove all the
          // style declarations from the CS call.
          removeStyleDeclarations(compiledStyles, path, pass);

          // All done! Let's replace this node with the user land child.
          path.replaceWith(nodeToReplace);
          path.node.leadingComments = null;
          return;
        }
      },
    },
  };
});
