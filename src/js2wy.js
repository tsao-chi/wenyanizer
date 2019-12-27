const { parse } = require("@babel/parser");
const { asc2wy } = require("./asc2wy");
const { getRandomChineseName, LAMBDA } = require("./utils");
// const GLOBAL_OBJECTS = [
//   "String",
//   "document",
//   "global",
//   "window",
//   "Math",
//   "Object",
//   "JSON",
//   "Array",
//   "Number",
// ];

//  Function names:
//
//    use handleXxxExpression when it may either push or consume the stack
//    use wrapXxxExpression as the function name when one will push the output to the stack
//    use consumeXxxExpression when it will consume the stack

function js2wy(jsStr) {
  const asc = js2asc(jsStr);
  return asc2wy(asc);
}

function js2asc(jsStr) {
  var jsAst, asc;
  try {
    jsAst = parse(jsStr);
  } catch (e) {
    e.message = "[JavaScript Grammar Error] " + e.message;
    throw e;
  }

  try {
    asc = ast2asc(jsAst, jsStr);
  } catch (e) {
    e.message = "[Ast2asc Error] " + e.message;
    throw e;
  }

  try {
    ascPostProcess(asc);
  } catch (e) {
    e.message = "[Post-processing error] " + e.message;
    throw e;
  }

  return asc;
}

function ascPostProcess(asc) {
  function getIdenOnlyUsedOnce() {
    const count = {};
    function add(name) {
      if (count[name] == null) {
        count[name] = 1;
      } else {
        count[name]++;
      }
    }

    for (const node of asc) {
      for (const key in node) {
        if (node[key] && node[key][0] === "iden") {
          add(node[key][1]);
        }
      }
    }

    const ans = new Set();
    for (const key in count) {
      if (count[key] === 1) {
        ans.add(key);
      }
    }

    return ans;
  }

  function findIgnorableIden(op) {
    for (const key in op) {
      if (
        op[key] &&
        op[key][0] === "iden" &&
        namesOnlyUsedOnce.has(op[key][1])
      ) {
        return op[key][1];
      }
    }

    return undefined;
  }

  function replaceIgnorableIden(op, name, newData) {
    for (const key in op) {
      if (op[key][0] === "iden" && op[key][1] === name) {
        op[key] = newData;
        return op;
      }
    }

    throw new Error();
  }

  const namesOnlyUsedOnce = getIdenOnlyUsedOnce();
  for (let i = 1; i < asc.length; i++) {
    const ignorable = findIgnorableIden(asc[i]);
    if (ignorable == null) {
      continue;
    }

    if (
      asc[i - 1].op === "var" &&
      asc[i - 1].values.length === 1 &&
      asc[i - 1].names.length === 1 &&
      asc[i - 1].names[0] === ignorable
    ) {
      replaceIgnorableIden(asc[i], ignorable, asc[i - 1].values[0]);
      asc.splice(i - 1, 1);
      i--;
    }
  }
}

const LITERAL_TYPES = {
  string: "lit",
  number: "num",
  function: "fun",
  boolean: "bool",
  StringLiteral: "lit",
  NumericLiteral: "num",
  Identifier: "iden",
  BooleanLiteral: "bool"
};

const DECLARATION_TYPES = Object.assign(
  {
    VariableDeclarator: "var"
  },
  LITERAL_TYPES
);

var tmpVars = [];
var allVars = [];
var varSet = new Set();
function getNextTmpName() {
  const name = getRandomChineseName(varSet);
  tmpVars.push(name);
  return name;
}

function mapType(type, value) {
  if (DECLARATION_TYPES[type]) {
    return DECLARATION_TYPES[type];
  }

  if (type === "ArrowFunctionExpression" || type === "FunctionExpression") {
    return "fun";
  }

  if (type === "ArrayExpression") {
    return "arr";
  }

  if (type === "ObjectExpression") {
    return "obj";
  }

  if (value instanceof Array) {
    return "arr";
  }

  if (value instanceof Object) {
    return "obj";
  }

  throw new Error(`Unknown type ${typeof value} of ${value}`);
}

const LITERALS = {
  NumericLiteral: "num",
  Identifier: "iden",
  BooleanLiteral: "bol",
  StringLiteral: "str"
};

const COMPARE_OPERATORS = ["!=", "==", ">=", "<=", "<", ">", "===", "!=="];
const OPERATORS = [
  "===",
  "!==",
  "!=",
  "==",
  ">=",
  "<=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&&",
  "||"
];

function isSimpleForm(_node) {
  return OPERATORS.includes(_node.operator);
}

function tryTurnThisExpressionToIdentifier(_node) {
  if (_node.type === "ThisExpression") {
    _node.type = "Identifier";
    _node.name = "this";
  }
}

function getNamesOnlyUsedOnce(body) {
  const counter = {};
  function count(v) {
    if (v in counter) {
      counter[v] += 1;
    } else {
      counter[v] = 1;
    }
  }

  function _get(node, insideTest = false) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (node.type === "Identifier") {
      count(node.name);
      if (insideTest) {
        count(node.name);
        count(node.name);
      }
      return;
    }

    if (node instanceof Array) {
      for (const subNode of node) {
        _get(subNode, insideTest);
      }

      return;
    }

    for (const key in node) {
      const v =
        insideTest || key === "test" || key === "arguments" || key === "update";
      // (key === "right" && node.type === "ForOfStatement");
      _get(node[key], v);
    }
  }

  _get(body);
  const ans = new Set();
  for (const key in counter) {
    if (counter[key] === 2) {
      ans.add(key);
    }
  }

  return ans;
}

/**
 * Return whether a variable is reassigned in an expression or a statement
 *
 * @param {name of a variable} name
 * @param {the node where the variable might be reassigned} node
 */
function isReassigned(name, node) {
  if (!node || typeof node !== "object") {
    return false;
  }

  if (
    node.left &&
    node.left.name === name &&
    node.type === "AssignmentExpression"
  ) {
    return true;
  }

  if (node.type === "UpdateExpression" && node.argument.name === name) {
    return true;
  }

  if (node instanceof Array) {
    for (const sub of node) {
      if (isReassigned(name, sub)) {
        return true;
      }
    }

    return false;
  }

  for (const key in node) {
    if (isReassigned(name, node[key])) {
      return true;
    }
  }

  return false;
}

function isIteratingFromZeroToN(_node) {
  if (!_node.init || _node.init.declarations.length !== 1) {
    return false;
  }

  try {
    if (_node.init.declarations[0].init.value !== 0) {
      return false;
    }

    if (_node.test.left.name !== _node.init.declarations[0].id.name) {
      return false;
    }

    if (_node.test.operator !== "<") {
      return false;
    }

    if (!(_node.test.right.type in LITERALS)) {
      return false;
    }

    if (_node.update.operator !== "++") {
      return false;
    }
  } catch (e) {
    return false;
  }

  return true;
}

/**
 * Convert JS AST to Wenyan Lang ASC
 *
 * @param {Ast} ast
 * @param {string} js
 */
function ast2asc(ast, js) {
  tmpVars = [];
  allVars = [];
  const signatureCache = {};
  const namesOnlyUsedOnce = getNamesOnlyUsedOnce(ast.program.body);
  const nodes = ast.program.body;
  const NEW_SIGNATURE = "JS_NEW()";
  const NEW_FUNC_NAME = "造物";
  // const INDEX_SIGNATURE = "JS_INDEX()";
  const INDEX_FUNC = "求索";
  const INDEX_ASSIGN_SIGNATURE = "JS_INDEX_ASSIGN()";
  const INDEX_ASSIGN_FUNC = "賦值";
  const JS_SUBSCRIPT = "JsSubscript()";
  const JS_SUBSCRIPT_FUN = "獲取";
  varSet = new Map();
  varSet.set(NEW_FUNC_NAME, 1);
  varSet.set(INDEX_FUNC, 1);
  varSet.set(INDEX_ASSIGN_FUNC, 1);
  varSet.set(JS_SUBSCRIPT_FUN, 1);
  let postProcess = []; // handle a++
  let ans = [];
  const polyfillAns = [];
  for (var node of nodes) {
    process(node);
    consumePostProcess();
  }

  if (polyfillAns.length) {
    polyfillAns.push({
      op: "comment",
      value: ["lit", `"================================="`]
    });
    ans = polyfillAns.concat(ans);
  }

  return ans;

  function consumePostProcess() {
    for (var func of postProcess) {
      func();
    }

    postProcess = [];
  }

  function process(_node) {
    switch (_node.type) {
      case "VariableDeclaration":
        handleDeclaration(_node);
        break;
      case "ExpressionStatement":
        handleExpressionStatement(_node.expression);
        break;
      case "UpdateExpression":
      case "CallExpression":
        handleExpressionStatement(_node);
        break;
      case "DoWhileStatement":
      case "WhileStatement":
        ans.push({
          op: "whiletrue"
        });

        if (_node.type === "WhileStatement") {
          breakWhenTestIsFalse(_node.test);
        }

        processNodesAndHandlePostProcess(_node.body.body);

        if (_node.type === "DoWhileStatement") {
          breakWhenTestIsFalse(_node.test);
        }

        ans.push({
          op: "end"
        });
        break;
      case "IfStatement":
        addIfTestExpression(_node);

        if (_node.consequent.body) {
          processNodesAndHandlePostProcess(_node.consequent.body);
        } else {
          process(_node.consequent);
        }

        if (_node.alternate) {
          ans.push({
            op: "else"
          });
          if (_node.alternate.body) {
            processNodesAndHandlePostProcess(_node.alternate.body);
          } else {
            process(_node.alternate);
          }
        }

        ans.push({
          op: "end"
        });
        break;
      case "BreakStatement":
        ans.push({
          op: "break"
        });
        break;
      case "LogicalExpression":
      case "BinaryExpression":
        wrapBinaryExpression(_node);
        break;
      case "ObjectExpression":
        assert(_node._name != null);
        addVarOp([_node._name], [], "obj");
        initObjectProperties(_node._name, _node.properties);
        break;
      case "ReturnStatement": {
        const v = {
          op: "return",
          value: getTripleProp(_node.argument, false),
          pos: _node.start
        };
        if (v.value == null) {
          delete v.value;
        }
        ans.push(v);
        break;
      }
      case "ForStatement":
        handleForStatement(_node);
        break;
      case "ForOfStatement":
        assert(_node.right.type === "Identifier");
        ans.push({
          op: "for",
          container: _node.right.name,
          iterator: getTripleProp(_node.left, false)[1]
        });

        processNodesAndHandlePostProcess(_node.body.body);
        ans.push({
          op: "end"
        });
        break;
      case "MemberExpression":
        handleMemberExpression(_node);
        break;
      case "ArrayExpression":
        handleArrayExpression(_node);
        break;
      case "UnaryExpression":
        wrapUnaryExpression(_node);
        break;
      case "FunctionExpression": {
        wrapFunctionExpression(_node);
        break;
      }
      case "FunctionDeclaration":
        addVarOp([_node.id.name], [], "fun");
        addFunction(_node);
        break;
      case "NewExpression":
        wrapJsNewExpression(_node);
        break;
      case "SequenceExpression":
        processNodesAndHandlePostProcess(_node.expressions);
        break;
      case "AssignmentExpression":
        handleAssignmentExpression(_node);
        break;
      case "EmptyStatement":
        break;
      default:
        notImpErr(_node);
    }
  }

  function wrapUnaryExpression(_node) {
    if (_node.operator === '!') {
      ans.push({
        op: "not",
        value: getTripleProp(_node.argument, true),
        pos: _node.start
      });
    }
    else if (_node.operator === '-') {
      ans.push({
        op: 'op-',
        lhs: ['num', 0, _node.start],
        rhs: getTripleProp(_node.argument, true),
        pos: _node.start
      });
    }
    else {
      notImpErr();
    }
  }

  function breakWhenTestIsFalse(test) {
    const v = getTripleProp(test);
    if (v[0] === "bool") {
      if (v[1]) {
        // <del> if (!true) {break} </del>
        return;
      } else {
        // <del> if (!false) </del> break
        ans.push({
          op: "break"
        });
      }

      return;
    }

    ans.push({
      op: "if",
      test: [v, ["cmp", "=="], ["num", 0]]
    });
    ans.push({
      op: "break"
    });
    ans.push({
      op: "end"
    });
  }

  function wrapBinaryExpression(_node) {
    if (isSimpleForm(_node)) {
      // TODO: remove name hotfix when op== op<= is supported officially
      ans.push({
        lhs: getTripleProp(_node.left, false),
        rhs: getTripleProp(_node.right, true),
        op: "op" + _node.operator,
        name: _node._name
      });
    } else {
      notImpErr(_node);
    }
  }

  function wrapFunctionExpression(_node) {
    // Maybe there is a better way to wrap this in future
    const name = getNextTmpName();
    addVarOp([name], [], "fun");
    addFunction(_node);
    addVarOp([], [["iden", name]], "fun");
  }

  function handleArrayExpression(_node) {
    const name = _node._name || getNextTmpName();
    addVarOp([name], [], "arr");
    ans.push({
      op: "push",
      container: name,
      values: _node.elements.map((x) => getTripleProp(x, false))
    });
    if (_node._name == null) {
      // Stage this variable
      addVarOp([], [["iden", name]], "arr");
    }
  }

  function registerNewName(name, type) {
    if (!varSet.has(name)) {
      allVars.push(name);
    }

    varSet.set(name, type);
  }

  function addNamingOp(names) {
    ans.push({
      op: "name",
      names: names
    });

    for (const name of names) {
      registerNewName(name, "obj");
    }
  }

  function addReassignOp({ lhs, rhs, lhssubs = undefined }) {
    if (lhs[0] === "iden") {
      registerNewName(lhs[1]);
    }

    if (lhssubs) {
      ans.push({
        op: "reassign",
        lhs,
        rhs,
        lhssubs
      });
    } else {
      ans.push({
        op: "reassign",
        lhs,
        rhs
      });
    }
  }

  function addVarOp(names, values, type, polyfill = false) {
    const count = Math.max(names.length, values.length);
    for (let i = 0; i < count; i++) {
      if (names[i]) {
        assert(typeof names[i] === "string");
      }
      if (values[i]) {
        assert(values[i] instanceof Array);
        assert(values[i][0] == null || typeof values[i][0] === "string");
      }
    }

    const op = {
      op: "var",
      count,
      names,
      values,
      type
    };

    if (polyfill) {
      polyfillAns.push(op);
    } else {
      ans.push(op);
    }

    for (const name of names) {
      registerNewName(name, type);
    }
  }

  function saveStagedToNewVar() {
    const newName = getNextTmpName();
    addNamingOp([newName]);
    return newName;
  }

  function getIfProp(_node) {
    if (_node.type === "MemberExpression") {
      if (
        _node.object.type === "Identifier" &&
        _node.property.type === "Identifier" &&
        _node.property.name === "length"
      ) {
        return [
          ["iden", _node.object.name],
          ["ctnr", "len"]
        ];
      } else if (
        _node.object.type === "Identifier" &&
        _node.property.type === "BinaryExpression" &&
        _node.property.operator === "-" &&
        _node.property.right.type === "NumericLiteral" &&
        _node.property.right.value === 1
      ) {
        return [
          ["iden", _node.object.name],
          ["ctnr", "subs"],
          getTripleProp(_node.property.left, false)
        ];
      } else {
        return [getTripleProp(_node, false)];
      }
    } else if (_node.type in LITERAL_TYPES) {
      return [getTripleProp(_node, false)];
    } else if ( _node.type.endsWith("Expression")) {
      return [getTripleProp(_node, false)];
    } else {
      notImpErr(_node);
    }
  }

  function tryToCompress(name) {
    if (!namesOnlyUsedOnce.has(name)) {
      return false;
    }

    const last = ans[ans.length - 1];
    if (last.op === "var" && last.names[last.names.length - 1] === name) {
      last.names.splice(last.names.length - 1, 1);
      return true;
    }

    if (
      last.op === "reassign" &&
      last.lhs[1] === name &&
      last.lhssubs == null
    ) {
      ans.splice(ans.length - 1, 1);
      return true;
    }

    if (
      last.op === "name" &&
      last.names.length === 1 &&
      last.names[0] === name
    ) {
      ans.splice(ans.length - 1, 1);
      return true;
    }

    return false;
  }

  /**
   * This function is used to wrap the global object
   * which has not been supported by wenyan.
   *
   * 1. It will create necessary function
   * 2. Invoke the function
   *
   * @param {*} _node
   */
  function wrapJsGlobalFunction(_node) {
    // FIXME: it also wrap function call on rhs
    assert(_node.type === "CallExpression");
    let signature = "";
    const args = [];
    function _getSignature(target) {
      if (target.type === "Identifier") {
        signature += target.name;
      } else if (target.type === "MemberExpression") {
        _getSignature(target.object);
        signature += ".";
        _getSignature(target.property);
      } else if (target.type === "CallExpression") {
        _getSignature(target.callee);
        assert(target.arguments.length <= LAMBDA.length);
        signature += "(";
        for (let i = 0; i < target.arguments.length; i++) {
          // Chinese char may introduce error
          // const name = "子" + LAMBDA[i];
          const name = "_a" + i;
          signature += `${name},`;
          args.push(name);
        }
        signature += ")";
      } else {
        notImpErr();
      }
    }

    _getSignature(_node);
    let funcName;
    if (signature in signatureCache) {
      funcName = signatureCache[signature];
    } else {
      funcName = getNextTmpName();
      signatureCache[signature] = funcName;
      // TODO: refactor, extract all func together
      addVarOp([funcName], [], "fun", false);
      ans.push({
        op: "fun",
        arity: _node.arguments.length,
        args: _node.arguments.map((x, index) => {
          return { type: "obj", name: args[index] };
        }),
        pos: _node.start
      });

      ans.push({
        op: "funbody"
      });
      ans.push({
        op: "return",
        value: ["data", signature]
      });
      ans.push({
        op: "funend"
      });
    }

    ans.push({
      op: "call",
      fun: funcName,
      args: _node.arguments.map((x) => getTripleProp(x, false)),
      pos: _node.start
    });
  }

  function wrapJsNativeFunction(signature, funcName, args, value) {
    if (!(signature in signatureCache)) {
      addVarOp([funcName], [], "fun", true);
      polyfillAns.push({
        op: "fun",
        arity: args.length,
        args: args
      });

      polyfillAns.push({
        op: "funbody"
      });
      polyfillAns.push({
        op: "return",
        value: ["data", value]
      });
      polyfillAns.push({
        op: "funend"
      });
      signatureCache[signature] = funcName;
    }
  }

  function wrapJsNewExpression(_node) {
    assertStrongly(_node.type === "NewExpression");
    wrapJsNativeFunction(
      NEW_SIGNATURE,
      NEW_FUNC_NAME,
      [{ type: "obj", name: "蓝图" }],
      "new 蓝图(...Array.prototype.slice.call(arguments, 1))"
    );

    ans.push({
      op: "call",
      fun: NEW_FUNC_NAME,
      args: [_node.callee]
        .concat(_node.arguments)
        .map((x) => getTripleProp(x, false)),
      pos: _node.start
    });
  }

  // function wrapJsIndexing(_node) {
  //   wrapJsNativeFunction(
  //     INDEX_SIGNATURE,
  //     INDEX_FUNC,
  //     [{ type: "obj", name: "道" }],
  //     "typeof 道 === 'string'? 道 : 道 + 1"
  //   );

  //   ans.push({
  //     op: "call",
  //     fun: INDEX_FUNC,
  //     args: [getTripleProp(_node)],
  //     pos: _node.start
  //   });
  // }

  function wrapJsSubscript(obj, field) {
    wrapJsNativeFunction(
      JS_SUBSCRIPT,
      JS_SUBSCRIPT_FUN,
      [
        { type: "obj", name: "對象" },
        { type: "obj", name: "域" }
      ],
      "對象[域]"
    );

    ans.push({
      op: "call",
      fun: JS_SUBSCRIPT_FUN,
      args: [obj, field]
    });
  }

  function wrapJsIndexAssignment(lhs, lhssubs, rhs) {
    wrapJsNativeFunction(
      INDEX_ASSIGN_SIGNATURE,
      INDEX_ASSIGN_FUNC,
      [
        { type: "obj", name: "對象" },
        { type: "obj", name: "域" },
        { type: "obj", name: "值" }
      ],
      "對象[域] = 值;"
    );

    ans.push({
      op: "call",
      fun: INDEX_ASSIGN_FUNC,
      args: [lhs, lhssubs, rhs]
    });
  }

  /**
   * Get the triple tuple representation (used in Wenyan ASC) of a node
   *
   * @param {Node} _node
   * @param {boolean} canUseStaged
   */
  function getTripleProp(_node, canUseStaged = false) {
    if (_node == null) {
      return undefined;
    }

    function wrap() {
      if (canUseStaged) {
        return ["ans", null];
      }

      const name = getNextTmpName();
      addNamingOp([name]);
      return ["iden", name, _node.start];
    }

    if (_node.type === "CallExpression") {
      handleUniversalCallExp(_node);
      return wrap();
    }

    if (_node.type === "MemberExpression" || _node.type === "CallExpression") {
      process(_node);
      return wrap();
    }

    if (_node.type === "ArrayExpression") {
      _node._name = getNextTmpName();
      process(_node);
      return ["iden", _node._name, _node.start];
    }

    if (_node.type === "VariableDeclaration") {
      const names = handleDeclaration(_node);
      assert(names.length === 1);
      return ["iden", names[0], _node.start];
    }

    if (
      _node.type === "BinaryExpression" ||
      _node.type === "LogicalExpression" ||
      _node.type === "ObjectExpression" ||
      _node.type === "FunctionExpression" ||
      _node.type === "NewExpression"
    ) {
      // TODO: remove this hotfix in the future version
      if (
        _node.type === "ObjectExpression" ||
        COMPARE_OPERATORS.includes(_node.operator)
      ) {
        _node._name = getNextTmpName();
        process(_node);
        return ["iden", _node._name, _node.start];
      }
      process(_node);
      return wrap();
    }

    if (_node.type === "UnaryExpression") {
      if (_node.operator === "-") {
        if (_node.argument.type === "NumericLiteral") {
          return ["num", -_node.argument.value];
        }

        ans.push({
          op: "op-",
          lhs: ["num", 0],
          rhs: getTripleProp(_node.argument, true)
        });

        return wrap();
      } else if (_node.operator === "!") {
        ans.push({
          op: "not",
          value: getTripleProp(_node.argument, true),
          pos: _node.start
        });
        return wrap();
      } else {
        notImpErr(_node);
      }
    }

    if (_node.type === "UpdateExpression") {
      handleUpdateExpression(_node);
      return getTripleProp(_node.argument);
    }

    if (_node.type === 'AssignmentExpression') {
      handleAssignmentExpression(_node);
      return getTripleProp(_node.left)
    }

    tryTurnThisExpressionToIdentifier(_node);
    if (!(_node.type in LITERAL_TYPES)) {
      notImpErr(_node);
    }

    if (_node.type === "Identifier") {
      if (canUseStaged && tryToCompress(_node.name)) {
        return ["ans", null];
      }

      return ["iden", _node.name, _node.start];
    }

    if (_node.type === "StringLiteral") {
      if (_node.value) {
        return ["lit", `"${_node.value}"`, _node.start];
      }

      return ["lit", null, _node.start];
    }

    return [LITERAL_TYPES[_node.type], _node.value, _node.start];
  }

  function handleUniversalCallExp(_node) {
    if (varSet.has(_node.callee.name)) {
      ans.push({
        op: "call",
        fun: _node.callee.name,
        args: _node.arguments.map((x) => getTripleProp(x, false)),
        pos: _node.start
      });
    } else {
      wrapJsGlobalFunction(_node);
    }
  }

  function assertStrongly(cond, _node, msg = "") {
    if (!cond) {
      const errorSnippet = js.slice(_node.start, _node.end);
      console.log(errorSnippet);
      throw new Error(`AssertError: line ${_node.loc.start.line}, col ${_node.loc.start.column};
    \t"${errorSnippet}"
    \t${msg}
    This is weird 😣. If you see this message, it means our tests haven't covered this case. 
    Please submit an issue to help us fix it! https://github.com/zxch3n/wenyanizer/issues/new
    `);
    }
  }

  function assert(cond, msg) {
    if (!cond) {
      throw new Error(msg + JSON.stringify(node.loc.start));
    }
  }

  function notImpErr(_node = node, msg = "") {
    const errorSnippet = js.slice(_node.start, _node.end);
    console.log(errorSnippet);
    throw new Error(`NotImplementedError: line ${_node.loc.start.line}, col ${_node.loc.start.column};
    \t"${errorSnippet}"
    \t${msg}
    The grammar is not supported yet.
    `);
  }

  function addFunction(funcNode) {
    ans.push({
      op: "fun",
      arity: funcNode.params.length,
      args: funcNode.params.map((x) => {
        const props = getTripleProp(x);
        return {
          name: props[1],
          type: "obj"
        };
      }),
      pos: funcNode.start
    });
    if (funcNode.id) {
      // Skip Anonymous Function
      registerNewName(funcNode.id.name, "fun");
    }
    ans.push({
      op: "funbody",
      pos: funcNode.start
    });
    processNodesAndHandlePostProcess(funcNode.body.body);
    ans.push({
      op: "funend",
      pos: funcNode.end
    });
    // clear the stack
    ans.push({
      op: "discard"
    });
  }

  function createTempVarToWrap(values, type = undefined, names = []) {
    const tripleRep = values.map((x) => getTripleProp(x, false));
    ({ type } = preprocessTypeValueBeforeDeclare(
      type || tripleRep[0][0],
      values[0]
    ));
    if (type === "iden") {
      type = varSet.get(values[0]);
      assert(type != null);
    }

    addVarOp(names, tripleRep, type);
  }

  function getTest(test) {
    if (test.type === "BinaryExpression") {
      if (COMPARE_OPERATORS.includes(test.operator)) {
        return [
          ...getIfProp(test.left),
          ["cmp", test.operator],
          ...getIfProp(test.right)
        ];
      } else if (test in LITERAL_TYPES) {
        return [getTripleProp(test, false)];
      } else {
        notImpErr(test);
      }
    } else if (test.type in LITERAL_TYPES) {
      return [getTripleProp(test, false)];
    } else if (
      test.type === "LogicalExpression" ||
      test.type === "BinaryExpression" ||
      test.type === "UnaryExpression"
    ) {
      return [getTripleProp(test, false)];
    } else if (test.type === "CallExpression") {
      // FIXME: unsure
      return [getTripleProp(test, false)];
    } else {
      notImpErr(test);
    }

    notImpErr(test);
  }

  function addIfTestExpression(_node) {
    ans.push({
      op: "if",
      test: getTest(_node.test),
      pos: _node.start
    });
  }

  function handleExpressionStatement(_node) {
    switch (_node.type) {
      case "CallExpression":
        handleCallExpression(_node);
        break;
      case "ExpressionStatement":
        process(_node.expression);
        break;
      case "AssignmentExpression":
        handleAssignmentExpression(_node);
        break;
      case "UpdateExpression":
        handleUpdateExpression(_node);
        break;
      default:
        notImpErr(_node, `Unknown expression ${_node.expression.type}`);
    }
  }

  function handleUpdateExpressionImmediately(_node) {
    assertStrongly(_node.operator === "++" || _node.operator === "--", _node);
    if (_node.argument.type === "MemberExpression") {
      handleAssignWithLhsMemberExpression({
        ..._node,
        left: _node.argument,
        right: {
          ..._node,
          type: "BinaryExpression",
          operator: _node.operator[0],
          left: _node.argument,
          right: {
            ..._node,
            type: "NumericLiteral",
            value: 1
          }
        },
        type: "AssignmentExpression"
      });
      return;
    }

    assertStrongly(_node.argument.type === "Identifier", _node);
    ans.push({
      op: "op" + _node.operator[0],
      lhs: ["iden", _node.argument.name],
      rhs: ["num", 1, _node.start]
    });
    addReassignOp({
      lhs: ["iden", _node.argument.name],
      rhs: ["ans", null]
    });
  }

  function handleUpdateExpression(_node) {
    // Use _done flag to avoid execute update multiple times
    // because getTripleProp may invoke this node from different ancester.
    // I may need to cache getTripleProp
    if (_node._done) {
      return;
    }

    _node._done = true;
    if (_node.prefix) {
      handleUpdateExpressionImmediately(_node);
    } else {
      postProcess.push(() => {
        handleUpdateExpressionImmediately(_node);
      });
    }
  }

  function handleCallExpression(_node) {
    if (_node.callee.type === "Identifier") {
      ans.push({
        op: "call",
        fun: _node.callee.name,
        args: _node.arguments.map((x) => getTripleProp(x, false)),
        pos: _node.start
      });
    } else if (_node.callee.object.name === "console") {
      let isShinkable = true;
      const n = _node.arguments.length;
      for (let j = 0; j < n; j++) {
        const name = _node.arguments[j].name;
        if (
          name !== allVars[allVars.length - n + j] ||
          !namesOnlyUsedOnce.has(name) ||
          ans[ans.length - n + j].names[0] !== name
        ) {
          isShinkable = false;
          break;
        }
      }
      if (isShinkable) {
        // Remove the declaration target
        for (let j = 0; j < n; j++) {
          if (ans[ans.length - n + j].op === "var") {
            ans[ans.length - n + j].names = [];
          } else if (ans[ans.length - n + j].op === "name") {
            ans.splice(ans.length - n + j, 1);
          }
        }
      } else {
        createTempVarToWrap(_node.arguments);
      }
      ans.push({
        op: "print"
      });
    } else if (
      _node.callee.type === "MemberExpression" &&
      _node.callee.property.name === "push"
    ) {
      assert(_node.callee.object.type === "Identifier");
      ans.push({
        op: "push",
        container: _node.callee.object.name,
        pos: _node.callee.object.start,
        values: _node.arguments.map((x) => getTripleProp(x, false))
      });
    } else if (_node.callee.type.endsWith("MemberExpression")) {
      // Concat
      let isConcat = true;
      let isSliceOne = false;
      let callExp = _node;
      const allArr = [];
      while (callExp && callExp.type === "CallExpression") {
        if (callExp.arguments.length !== 1) {
          isConcat = false;
          break;
        }
        allArr.push(callExp.arguments[0].name);
        if (callExp.callee.property.name !== "concat") {
          isConcat = false;
          break;
        }
        callExp = callExp.callee.object;
      }
      if (
        _node.callee.property.name === "slice" &&
        _node.arguments.length === 1 &&
        _node.arguments[0].value === 1 &&
        _node.callee.object.type === "Identifier"
      ) {
        isSliceOne = true;
      }
      if (isConcat) {
        allArr.push(callExp.name);
        ans.push({
          op: "cat",
          containers: allArr.reverse(),
          pos: _node.start
        });
        return;
      } else if (isSliceOne) {
        ans.push({
          op: "subscript",
          container: _node.callee.object.name,
          value: ["ctnr", "rest"]
        });
        return;
      }

      handleUniversalCallExp(_node);
    } else {
      notImpErr(_node);
    }
  }

  function handleAssignmentExpression(_node) {
    if (_node.operator.length === 2) {
      // if op in {+=, -=, *=, ...}
      assertStrongly(_node.operator[1] === "=", _node);
      _node.right = {
        type: "BinaryExpression",
        operator: _node.operator[0],
        left: _node.left,
        right: _node.right
      };

      _node.operator = "=";
    }

    assertStrongly(_node.operator === "=", _node);
    if (_node.left.type === "Identifier") {
      if (_node.right.type === "FunctionExpression") {
        {
          // Assert we have initialized the function
          const last = ans[ans.length - 1];
          if (last.op !== "var" || last.names[0] !== _node.left.name) {
            notImpErr(_node);
          }
        }
        addFunction(_node.right);
      } else {
        addReassignOp({
          lhs: ["iden", _node.left.name],
          rhs: getTripleProp(_node.right, true)
        });
      }
    } else if (_node.left.type === "MemberExpression") {
      handleAssignWithLhsMemberExpression(_node);
    } else {
      assertStrongly(
        false,
        _node,
        "Assignment with left hand side of type that is nor Identifier nor MemberExpression"
      );
    }
  }

  function handleAssignWithLhsMemberExpression(_node) {
    let lhsName = undefined;
    if (_node.left.object.type === "MemberExpression") {
      // Cases like: `a['b']['c'] = 5`
      process(_node.left.object);
      lhsName = getNextTmpName();
      addNamingOp([lhsName]);
    }

    tryTurnThisExpressionToIdentifier(_node.left.object);
    if (_node.left.object.type !== "Identifier" && !lhsName) {
      notImpErr(_node);
    }

    const lhs = lhsName ? ["iden", lhsName] : ["iden", _node.left.object.name];
    if (
      _node.left.property.type === "BinaryExpression" &&
      _node.left.property.operator === "-" &&
      _node.left.property.right.value === 1
    ) {
      // Cases such as: a[b - 1], a[9 - 1]
      const lhssubs = getTripleProp(_node.left.property.left, false);
      addReassignOp({
        lhs,
        lhssubs,
        rhs: getTripleProp(_node.right, true)
      });
    } else if (_node.left.property.type === "StringLiteral") {
      // Cases like: a['123']
      addReassignOp({
        lhs,
        lhssubs: ["lit", `"${_node.left.property.value}"`],
        rhs: getTripleProp(_node.right, true)
      });
    } else if (_node.left.property.type === "NumericLiteral") {
      // Cases: a[0]
      addReassignOp({
        lhs,
        lhssubs: ["num", _node.left.property.value + 1],
        rhs: getTripleProp(_node.right, true)
      });
    } else if (js[_node.left.object.end] === ".") {
      addReassignOp({
        lhs,
        lhssubs: ["lit", `"${_node.left.property.name}"`],
        rhs: getTripleProp(_node.right, true)
      });
    } else {
      // wrapJsIndexing(_node.left.property);
      // const name = getNextTmpName();
      // addNamingOp([name]);
      wrapJsIndexAssignment(
        getTripleProp(_node.left.object),
        getTripleProp(_node.left.property),
        getTripleProp(_node.right, false)
      );
      // Clear the stack
      ans.push({
        op: "discard"
      });
    }
  }

  function handleDeclaration(_node, defaultType = "obj") {
    const names = [];
    for (let i = 0; i < _node.declarations.length; i++) {
      const declarator = _node.declarations[i];
      const name = declarator.id.name;
      if (declarator.init == null) {
        addVarOp([name], [], defaultType);
        names.push(name);
      } else if (declarator.init.type === "NewExpression") {
        wrapJsNewExpression(declarator.init);
        addNamingOp([name]);
      } else if (
        declarator.init.type === "BinaryExpression" ||
        declarator.init.type === "CallExpression" ||
        declarator.init.type === "MemberExpression" ||
        declarator.init.type === "UnaryExpression" ||
        declarator.init.type === "LogicalExpression"
      ) {
        declarator.init._name = name;
        process(declarator.init);
        if (COMPARE_OPERATORS.includes(declarator.init.operator)) {
          // FIXME: This is a ad-hoc fix for https://github.com/LingDong-/wenyan-lang/issues/317
        } else if (varSet.has(name)) {
          addReassignOp({
            lhs: ["iden", name],
            rhs: ["ans", null]
          });
        } else {
          addNamingOp([name]);
        }
        names.push(name);
      } else {
        let value = declarator.init.value || declarator.init.name;
        const dtype = mapType(declarator.init.type || typeof value, value);
        appendDeclaration(dtype, value, name);
        names.push(name);
        if (dtype === "fun") {
          if (
            declarator.init.body.extra &&
            declarator.init.body.extra.raw === "0"
          ) {
            // Empty function
            return;
          } else if (
            declarator.init.type === "ArrowFunctionExpression" ||
            declarator.init.type === "FunctionExpression"
          ) {
            addFunction(declarator.init);
          } else {
            notImpErr(declarator);
          }
        }

        if (dtype === "obj" && declarator.init.properties.length) {
          // TODO: use new Syntax when object initialization is available
          initObjectProperties(name, declarator.init.properties);
        }

        if (dtype === "arr" && declarator.init.elements.length) {
          ans.push({
            op: "push",
            container: name,
            values: declarator.init.elements.map((x) => getTripleProp(x, false))
          });
        }
      }
    }

    return names;
  }

  function initObjectProperties(name, properties) {
    for (const property of properties) {
      addReassignOp({
        lhs: ["iden", name],
        lhssubs: ["lit", `"${property.key.name || property.key.value}"`],
        rhs: getTripleProp(property.value, true)
      });
    }
  }

  function appendDeclaration(dtype, value, name) {
    let type;
    let toIgnoreValues;
    ({ type, toIgnoreValues, value } = preprocessTypeValueBeforeDeclare(
      dtype,
      value
    ));
    addVarOp([name], toIgnoreValues ? [] : [[dtype, value]], type);
  }

  function preprocessTypeValueBeforeDeclare(dtype, value) {
    let type = dtype;
    let toIgnoreValues = type === "fun" || type === "arr" || type === "obj";
    if (type === "iden") {
      type = varSet.get(value) || "obj";
    }
    if (type === "bool") {
      type = "bol";
    }
    if (dtype === "lit") {
      type = "str";
      if (value) {
        value = `"${value}"`;
      } else {
        toIgnoreValues = true;
      }
    }
    return { type, toIgnoreValues, value };
  }

  function handleMemberExpression(_node) {
    let object = _node.object;
    if (
      _node.object.type === "CallExpression" ||
      object.type === "MemberExpression"
    ) {
      process(_node.object);
      const newVar = saveStagedToNewVar();
      object = {
        name: newVar,
        type: "Identifier"
      };
    }

    tryTurnThisExpressionToIdentifier(object);
    assertStrongly(object.type === "Identifier", _node);
    if (_node.property.type.endsWith("Expression")) {
      if (_node.property.operator === "-" && _node.property.right.value === 1) {
        // a[b - 1]
        ans.push({
          op: "subscript",
          container: object.name,
          value: getTripleProp(_node.property.left, true)
        });
      } else {
        // a[Math.floor(b * 100 - 10)]
        wrapJsSubscript(getTripleProp(object), getTripleProp(_node.property));
      }
    } else if (_node.property.type in LITERAL_TYPES) {
      if (_node.property.name === "length") {
        ans.push({
          op: "length",
          container: object.name
        });
      } else if (_node.property.name != null) {
        if (_node.computed) {
          // a[b]
          wrapJsSubscript(
            getTripleProp(_node.object),
            getTripleProp(_node.property)
          );
        } else {
          // a.b
          ans.push({
            op: "subscript",
            container: object.name,
            value: ["lit", `"${_node.property.name}"`]
          });
        }
      } else if (_node.property.value != null) {
        if (_node.property.type === "StringLiteral") {
          ans.push({
            op: "subscript",
            container: object.name,
            value: ["lit", `"${_node.property.value}"`]
          });
        } else {
          assert(_node.property.type === "NumericLiteral");
          ans.push({
            op: "subscript",
            container: object.name,
            value: ["num", _node.property.value + 1]
          });
        }
      } else {
        // TODO: add this part when wenyan has type assertion
        // 1. if target is string, target[index]
        // 2. if target is number, target[index + 1]
        notImpErr(_node);
      }
    } else {
      notImpErr(_node);
    }
  }

  function handleForStatement(_node) {
    let initName = '';
    let _isReassigned = false;
    if (_node.init && _node.init.declarations) {
      for (const dec of _node.init.declarations) {
        initName = dec.id.name;
        if (isReassigned(dec.id.name, _node.body)) {
          _isReassigned = true;
          break;
        }
      }
    }

    // whether it is in the format of `for (let i = 0; i < n; i++)`
    let shouldAddManualBreak =
      _isReassigned ||
      !_node.init ||
      !_node.init.declarations ||
      !_node.init.declarations.length ||
      _node.init.declarations[0].init.value !== 0 ||
      !_node.update ||
      _node.update.operator !== "++" ||
      _node.update.argument.name !== initName ||
      (_node.test &&
        (_node.test.left.name !== initName ||
          _node.test.operator !== "<" ||
          !(_node.test.right.type in LITERAL_TYPES)));

    const shouldInit =
      shouldAddManualBreak ||
      (_node.init &&
        _node.init.declarations &&
        _node.init.declarations[0] &&
        !_node.init.declarations[0].id.name.startsWith("_rand"));

    if (shouldInit && _node.init) {
      process(_node.init);
    }

    if (shouldAddManualBreak) {
      ans.push({
        op: "whiletrue"
      });
    } else if (isIteratingFromZeroToN(_node)) {
      ans.push({
        op: "whilen",
        value: getTripleProp(_node.test.right),
        pos: _node.start
      });
    } else {
      notImpErr(_node);
    }

    // Test whether should break
    if (_node.test && shouldAddManualBreak) {
      breakWhenTestIsFalse(_node.test);
    }

    processNodesAndHandlePostProcess(_node.body.body);
    if (shouldInit && _node.update) {
      // Update before break test
      process(_node.update);
    }
    // update i++ immediately
    consumePostProcess();
    ans.push({
      op: "end"
    });
  }

  function processNodesAndHandlePostProcess(body) {
    for (const subNode of body) {
      consumePostProcess();
      process(subNode);
    }

    consumePostProcess();
  }
}

module.exports.js2wy = js2wy;
module.exports.ast2asc = ast2asc;
module.exports.js2asc = js2asc;
