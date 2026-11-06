// A deliberately small, explicit boundary. Unknown components retain full regression.
import fs from "node:fs";
import path from "node:path";
import { parse } from "vue/compiler-sfc";
import ts from "typescript";
import { presentationComponents, presentationTests } from "./presentation-policy.mjs";

function primitiveType(node) {
  return [ts.SyntaxKind.StringKeyword, ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.BooleanKeyword,
    ts.SyntaxKind.UndefinedKeyword].includes(node.kind)
    || ts.isLiteralTypeNode(node) && (ts.isStringLiteral(node.literal) || node.literal.kind === ts.SyntaxKind.NullKeyword)
    || ts.isUnionTypeNode(node) && node.types.every(primitiveType);
}
function expressionAllowed(source, props) {
  const ast = ts.createSourceFile("expression.ts", `const value = (${source});`, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length || ast.statements.length !== 1) return false;
  const visit = node => {
    if (ts.isParenthesizedExpression(node)) return visit(node.expression);
    if (ts.isIdentifier(node)) return props.has(node.text);
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
    if (ts.isObjectLiteralExpression(node)) return node.properties.every(p => ts.isPropertyAssignment(p)
      && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && visit(p.initializer));
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(visit);
    if (ts.isConditionalExpression(node)) return visit(node.condition) && visit(node.whenTrue) && visit(node.whenFalse);
    if (ts.isBinaryExpression(node)) return [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)
      && visit(node.left) && visit(node.right);
    return false;
  };
  const statement = ast.statements[0];
  return ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
    && visit(statement.declarationList.declarations[0].initializer);
}
export function assertPresentationSource(source, file = "presentation.vue") {
  const reject = message => { throw Error(`${file}: presentation boundary: ${message}`); };
  const { descriptor: d, errors } = parse(source, { filename: file });
  if (errors.length || d.script || !d.scriptSetup || d.scriptSetup.lang !== "ts" || d.scriptSetup.src
    || !d.template?.ast || d.template.src || d.template.lang || d.customBlocks.length) reject("inline TS props and HTML template required");
  if (Object.keys(d.scriptSetup.attrs).some(key => !["setup", "lang"].includes(key))
    || Object.keys(d.template.attrs).length) reject("unsupported SFC attributes");
  const script = ts.createSourceFile("props.ts", d.scriptSetup.content, ts.ScriptTarget.Latest, true);
  const statement = script.statements[0], call = statement && ts.isExpressionStatement(statement) && statement.expression;
  if (script.parseDiagnostics.length || script.statements.length !== 1 || !call || !ts.isCallExpression(call)
    || !ts.isIdentifier(call.expression) || call.expression.text !== "defineProps" || call.arguments.length
    || call.typeArguments?.length !== 1 || !ts.isTypeLiteralNode(call.typeArguments[0])) reject("only defineProps with primitive fields is allowed; keep imports, calculations and effects in the controller");
  const props = new Set();
  for (const member of call.typeArguments[0].members) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name) || !member.type
      || member.modifiers?.length || !primitiveType(member.type)) reject("props must be primitive display values");
    if (props.has(member.name.text)) reject("duplicate prop");
    props.add(member.name.text);
  }
  const expression = node => { if (node?.type !== 4 || !expressionAllowed(node.content, props)) reject("template expressions may only read display props"); };
  const walk = node => {
    if (node.type === 1) {
      if (!["div", "span", "label", "template", "slot"].includes(node.tag)) reject("only passive HTML and slot outlets are allowed");
      for (const prop of node.props) {
        if (prop.type === 6) {
          if (!["class", "title", "name"].includes(prop.name) || prop.name === "name" && node.tag !== "slot") reject("unsupported HTML attribute");
        } else if (prop.type === 7) {
          if (prop.modifiers.length) reject("directive modifiers are not allowed");
          if (prop.name === "bind") {
            if (!prop.arg?.isStatic || !["class", "title"].includes(prop.arg.content)) reject("only class/title bindings are allowed");
            expression(prop.exp);
          } else if (["if", "else-if"].includes(prop.name) && !prop.arg) expression(prop.exp);
          else if (prop.name !== "else" || prop.arg || prop.exp) reject("events and active directives belong in the controller");
        }
      }
    } else if (node.type === 5) expression(node.content);
    else if (![0, 2, 3].includes(node.type)) reject("unsupported template node");
    for (const child of node.children ?? []) walk(child);
  };
  walk(d.template.ast);
  for (const style of d.styles) {
    if (!style.scoped || Object.keys(style.attrs).some(key => key !== "scoped")
      || /@|url\s*\(|v-bind\s*\(|:(?:global|deep|slotted)|::?v-(?:global|deep|slotted)/i.test(style.content)) reject("styles must be local scoped CSS without external inputs");
  }
}
export function assertPresentationBoundaries(root) {
  for (const file of presentationComponents) assertPresentationSource(fs.readFileSync(path.join(root, file), "utf8"), file);
  for (const file of presentationTests) {
    if (!fs.existsSync(path.join(root, file))) throw Error(`Required presentation test missing: ${file}`);
  }
}
