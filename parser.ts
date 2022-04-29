import {parser} from "lezer-python";
import {TreeCursor} from "lezer-tree";
import {Expr, Stmt, BinaryOp, Type, TypedVar, VarDefs, Literal, Program, MethodDefs, UnaryOp, ClassDefs} from "./ast";
import { stringifyTree } from "./treeprinter";


function isVarDecl(c: TreeCursor, s: string) : Boolean {
  if (c.type.name !== "AssignStatement")
    return false;
  c.firstChild();
  c.nextSibling();
  const name = c.type.name;
  c.parent();
  // @ts-ignore
  if (name !== "TypeDef")
    return false;
  return true;
} 

function isClassDef(c: TreeCursor, s: string) : Boolean {
  return c.type.name === "ClassDefinition"
}

function isMethodDef(c: TreeCursor, s: string) : Boolean {
  return c.type.name === "FunctionDefinition"
}

export function traverseType(c : TreeCursor, s: string) : Type {
  switch(s.substring(c.from, c.to)) {
    case "int": 
      return "int";
    case "bool": 
      return "bool"
    case "None": 
      return "none";
    default:
      return {tag: "object", class: s.substring(c.from, c.to)}
  }
}

export function traverseTypedVar(c : TreeCursor, s: string) : TypedVar<null> {
  const name = s.substring(c.from, c.to);
  c.nextSibling(); // TypeDef parse
  c.firstChild(); // :
  c.nextSibling(); // type
  const type = traverseType(c, s);
  c.parent();
  return {name, type};
}

export function traverseLiteral(c: TreeCursor, s: string) : Literal<null> {
  switch(c.type.name) {
    case "Number":
      return {tag: "num", value: Number(s.substring(c.from, c.to))};
    case "Boolean":
      return {tag: "bool", value: s.substring(c.from, c.to) === "True" };
    case "None":
      return {tag: "none"}
    default:
      throw new Error("PARSE ERROR : Unexpected Literal Type");
  }
}

export function traverseClassDefs(c : TreeCursor, s: string) : ClassDefs<null> {
  c.firstChild(); // Go to class
  if (s.substring(c.from, c.to) !== "class") 
    throw new Error("PARSE ERROR: does not use class keyword")
  c.nextSibling(); //Go to class name
  var className = s.substring(c.from, c.to)
  c.nextSibling(); // Go to argList
  if (s.substring(c.from, c.to) !== "ArgList")
    throw new Error("PARSE ERROR : no default object passed during class definition")
  c.firstChild();
  c.nextSibling();
  if (s.substring(c.from, c.to) !== "object")
    throw new Error("PARSE ERROR : default arg not of type object")
  c.parent();
  c.nextSibling(); // Go to Body
  c.firstChild(); // Go to :
  c.nextSibling(); // Go inside body
  
  const fields : VarDefs<null>[] = [];
  const methods : MethodDefs<null>[] = [];

  do {
    if (isVarDecl(c,s)) {
      fields.push(traverseVarDefs(c,s));
    } else if (isMethodDef(c,s)) {
      methods.push(traverseMethodDefs(c,s));
    } else {
      throw new Error("PARSE ERROR : Unknown type")
    }
  } while (c.nextSibling())

  return {name: className, fields, methods}

}

export function traverseVarDefs(c : TreeCursor, s: string) : VarDefs<null> {
  c.firstChild(); //name
  const {name, type} = traverseTypedVar(c, s);
  c.nextSibling(); //AssignOp
  c.nextSibling(); //value
  const init = traverseLiteral(c, s);
  c.parent();
  return {name, type, literal: init};
}

export function traverseMethodDefs(c : TreeCursor, s: string) : MethodDefs<null> {
  c.firstChild(); //def
  c.nextSibling();
  const fname = s.substring(c.from, c.to); // function name
  c.nextSibling(); // Param List
  c.firstChild(); // open paranthesis
  c.nextSibling() // go to either first param or )
  const params : TypedVar<null>[] = [];
  do {
    if (c.type.name === ")")
      break;
    //TODO : double check ,  
    if (c.type.name === ",")
      continue;
    params.push(traverseTypedVar(c, s));
  } while (c.nextSibling())
  c.parent(); // come out of params
  c.nextSibling(); // typeDef for return type

  var returnType : Type = "none"
  if (c.type.name === "TypeDef") {
    c.firstChild(); // go into return type
    //TODO : double check here if we need a nextSibling call
    c.nextSibling();
    returnType = traverseType(c, s)
    c.parent();
  }

  c.nextSibling(); //body parse
  c.firstChild(); //:
  c.nextSibling(); // first stmt

  const varInits : VarDefs<null>[] = [];
  const bodyStmts : Stmt<null>[] = [];

  do {
    if (isVarDecl(c, s)) {
      varInits.push(traverseVarDefs(c, s));
    } else if (isMethodDef(c, s)) {
      throw new Error("PARSE ERROR : Nested methods not supported");
    } else {
      break;
    }
  } while(c.nextSibling())

  do {
    if (isMethodDef(c,s) || isVarDecl(c,s)) {
      throw new Error("PARSE ERROR : variable and method definitions should be before statments");
    } 
    bodyStmts.push(traverseStmt(c, s));
  } while(c.nextSibling())

  c.parent(); // pop to body
  c.parent(); // pop to fn def

  if (returnType === "none")
    bodyStmts.push({tag : "return", value : {tag : "literal", literal : {tag: "none"}}}) // for empty return 
  
  return {name : fname, params, ret : returnType, body1: varInits, body2 : bodyStmts}
}

export function traverseExpr(c : TreeCursor, s : string) : Expr<null> {
  switch(c.type.name) {

    case "Number":
      return {
        tag : "literal",
        literal: traverseLiteral(c,s)
      }

    case "Boolean":
      return {
        tag : "literal",
        literal: traverseLiteral(c,s)
      }

    case "None":
      return {
        tag : "literal",
        literal: traverseLiteral(c,s)
      }

    case "VariableName":
      return {
        tag: "id",
        name: s.substring(c.from, c.to)
      }

    case "MemberExpression":
      c.firstChild()
      var exp = traverseExpr(c,s)
      c.nextSibling() // go to .
      c.nextSibling() // go to property
      var property = s.substring(c.from, c.to)
      c.parent()
      return {tag : "getField", name: property, obj : exp}

    case "CallExpression":
      c.firstChild(); // go to name
      const callName = s.substring(c.from, c.to);

      //@ts-ignore
      if (c.type.name === "MemberExpression") {
        c.firstChild();
        var exp = traverseExpr(c,s)
        c.nextSibling() // go to .
        c.nextSibling() // go to property
        var property = s.substring(c.from, c.to)
        c.parent()
        c.nextSibling(); // go to arglist
        var args = traverseArgs(c, s);
        c.parent();
        return {tag : "methodCall", lhs : exp, name : property, rhs : args}
      }

      c.nextSibling(); // go to arglist
      var args = traverseArgs(c, s);

      if (callName === "abs") {
        if (args.length === 1) {
          c.parent();
          return {
            tag: "builtin1",
            name: callName,
            arg: args[0]
          };
        } else {throw new Error("PARSE ERROR: unknown builtin1")}
      } else if (callName === "max" || callName === "min" || callName === "pow") {
        if (args.length === 2) {
          c.parent();
          return {
            tag: "builtin2",
            name: callName,
            arg1: args[0],
            arg2: args[1]
          };
        } else {throw new Error("PARSE ERROR: unknown builtin2")}
      } else {
        //TODO : Should we handle print separately ?
        c.parent();
        return {
          tag : "call",
          name : callName,
          args: args
        }
      }

    case "UnaryExpression":
      c.firstChild();
      var optr : UnaryOp;
      switch(s.substring(c.from, c.to)) {
        case "+":
          optr = UnaryOp.U_Plus;
          break;
        case "-":
          optr = UnaryOp.U_Minus;
          break;
        case "not":
          optr = UnaryOp.Not;
          break;
        default: 
          throw new Error("PARSE ERROR: unknown unary operator")
      }

      c.nextSibling();
      const rtarg = traverseExpr(c, s);
      c.parent();

      return {
        tag: "unExpr",
        op: optr,
        right: rtarg
      } 

    case "ParenthesizedExpression":
      c.firstChild(); // go to (
      c.nextSibling(); // go to Expr
      const expr = traverseExpr(c,s);
      c.parent();
      return expr;


    case "BinaryExpression":
      c.firstChild();
      const leftarg = traverseExpr(c, s); 
      c.nextSibling();

      var operator : BinaryOp;
      switch(s.substring(c.from, c.to)) {
        case "+":
          operator = BinaryOp.Plus;
          break;
        case "-":
          operator = BinaryOp.Minus;
          break;
        case "*":
          operator = BinaryOp.Mul;
          break;
        case "//":
          operator = BinaryOp.D_slash;
          break;
        case "%":
          operator = BinaryOp.Mod;
          break;
        case ">":
          operator = BinaryOp.Gt;
          break;
        case "<":
          operator = BinaryOp.Lt;
          break;
        case "<=":
          operator = BinaryOp.Leq;
          break;
        case ">=":
          operator = BinaryOp.Geq;
          break;
        case "==":
          operator = BinaryOp.Eq;
          break;
        case "!=":
          operator = BinaryOp.Neq;
          break;
        case "is":
          operator = BinaryOp.Is;
          break;
        default: 
          throw new Error("PARSE ERROR: unknown binary operator");
      }
      c.nextSibling();
      const rightarg = traverseExpr(c, s);
      c.parent();
      return {
        tag: "binExpr",
        left: leftarg,
        op: operator,
        right: rightarg
      }

    default:
      throw new Error("Could not parse expr at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to));
  }
}

export function traverseArgs(c: TreeCursor, s: string) : Array<Expr<null>> {
  var args : Array<Expr<null>> = [];
  c.firstChild(); // go into arglist
  while(c.nextSibling()) { // is this right ?
    if (c.type.name === ")")
      break;
    args.push(traverseExpr(c, s))
    c.nextSibling();
  }
  c.parent(); // pop arglist
  return args;
}

export function traverseStmt(c : TreeCursor, s : string) : Stmt<null> {
  switch(c.node.type.name) {
    case "AssignStatement":
      c.firstChild(); // go to name
      const name = c.type.name;
      if (name === "MemberExpression") {
        c.firstChild()
        var lhs = traverseExpr(c,s)
        c.nextSibling() // go to .
        var property = s.substring(c.from, c.to)
        c.parent()

        c.nextSibling(); // go to equals
        c.nextSibling(); // go to rhs expr
        const rhs = traverseExpr(c, s);
        c.parent();
        return { tag: "setField", name, lhs, rhs}
      } else {
        c.nextSibling(); // go to equals
        c.nextSibling(); // go to value
        const value = traverseExpr(c, s);
        c.parent();
        return {
          tag: "assign",
          name: name,
          value: value 
        }
      }
      
    case "ExpressionStatement":
      c.firstChild();
      const expr = traverseExpr(c, s);
      c.parent(); // pop going into stmt
      return { tag: "expr", expr: expr }

    case "PassStatement":
      return {tag : "pass"}

    case "ReturnStatement":
      c.firstChild(); //return tag
      c.nextSibling();
      const val = traverseExpr(c, s);
      c.parent();
      return {tag : "return", value: val}

    case "IfStatement":
      c.firstChild(); // go to If
      c.nextSibling(); // go to condition
      const condition = traverseExpr(c,s);
      c.nextSibling(); // move to Body
      const then_block = traverseBody(c, s);
      
      let curr_stmt: Stmt<null> = { tag: "ifElse", cond : condition, then : then_block, else: []};
      const result: Stmt<null> = curr_stmt;

      while (c.nextSibling()) {
        if (c.type.name === "elif") {
          c.nextSibling(); // go to condition
          const elif_cond = traverseExpr(c, s);
          c.nextSibling(); // move to elif body
          const elif_block = traverseBody(c, s);
          
          const new_stmt: Stmt<null> = { tag: "ifElse", cond : elif_cond, then: elif_block, else: []};
          curr_stmt.else = [new_stmt];
          curr_stmt = new_stmt;
        } 

        if (c.type.name === "else") {
          c.nextSibling(); // move to else body
          const else_block = traverseBody(c, s);
          curr_stmt.else = else_block;
        }
      }

      c.parent(); // Pop to IfStatement
      return result;

    case "WhileStatement":
      c.firstChild(); // go to while
      c.nextSibling(); // go to condition
      const cond = traverseExpr(c,s);
      c.nextSibling(); // move to Body
      const then = traverseBody(c, s);
      c.parent();
      return {tag : "while", cond, then}
    
    default:
      throw new Error("Could not parse stmt at " + c.node.from + " " + c.node.to + ": " + s.substring(c.from, c.to));
  }
}

export function traverseBody(c: TreeCursor, s: string) : Stmt<null>[] {
  var parsedStmts : Stmt<null>[] = []
  c.firstChild(); // move to  :
  while (c.nextSibling()) {
    parsedStmts.push(traverseStmt(c,s))
  }
  c.parent(); //back to body
  return parsedStmts
}

export function traverse(c : TreeCursor, s : string) : Program<null> {

  var stmts:Stmt<null>[] = [];
  var varDefs:VarDefs<null>[] = [];
  var classDefs:ClassDefs<null>[] = [];

  switch(c.node.type.name) {
    case "Script":
      c.firstChild();
      //Parse vars and classes first
      do {
        if (isVarDecl(c, s)) {
          varDefs.push(traverseVarDefs(c,s));
        } else if (isClassDef(c, s)) {
          classDefs.push(traverseClassDefs(c,s));
        } else {
          break;
        }
        if (c.nextSibling()) {
          continue;
        } else {
          return {varDefs, classDefs, stmts};
        }
      } while(true)

      // Parse statements next
      do {
        if (isVarDecl(c, s) || isClassDef(c, s)) {
          throw new Error("PARSE ERROR : Variable or Class definition encountered while parsing statements");
        } else {
          stmts.push(traverseStmt(c,s));
        }
      } while(c.nextSibling())

      return {varDefs, classDefs, stmts}
    
      default:
        throw new Error("Could not parse program at " + c.node.from + " " + c.node.to);
  }
}

export function parse(source : string) : Program<null> {
  const t = parser.parse(source);
  const strTree = stringifyTree(t.cursor(), source, 0);
  if (strTree == "Script\n")
    throw new Error("PARSE ERROR : Empty input or program");
  console.log(strTree);
  return traverse(t.cursor(), source);
}
