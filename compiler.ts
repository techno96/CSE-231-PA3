import wabt from "wabt";
import { Stmt, Expr, BinaryOp, FunDefs, Type, VarDefs, Literal, UnaryOp} from "./ast";
import { parse } from "./parser";
import { typeCheckProgram } from "./typechecker";

// https://learnxinyminutes.com/docs/wasm/

type LocalEnv = Map<string, boolean>;

export async function run(watSource : string, config: any) : Promise<number> {
  const wabtApi = await wabt();

  const parsed = wabtApi.parseWat("example", watSource);
  const binary = parsed.toBinary({});
  const wasmModule = await WebAssembly.instantiate(binary.buffer, config);
  return (wasmModule.instance.exports as any)._start();
}

export function compile(source: string) : string {
  let ast = typeCheckProgram(parse(source));
  var emptyEnv = new Map<string, boolean>();

  console.log(ast.varDefs.length)
  console.log(ast.varDefs)
  var varDecls = ast.varDefs.map(v => `(global $${v.name} (mut i32) (i32.const 0))`).join("\n");
  console.log(varDecls)
  var varDefs : string[] = codeGenVarDefs(ast.varDefs, emptyEnv);

  var funsCode : string[] = ast.funDefs.map(f => codeGenFunction(f, emptyEnv)).map(f => f.join("\n"));
  funsCode.join("\n\n");
  
  var allStmts = ast.stmts.map(s => codeGenStmt(s, emptyEnv)).flat();
  var main = [`(local $scratch i32)`, ...varDefs, ...allStmts].join("\n");

  var retType = "";
  var retVal = "";
  if (ast.stmts.length > 0) {
    var lastStmt = ast.stmts[ast.stmts.length - 1];
    var isExpr = lastStmt.tag === "expr";

    if(isExpr) {
      retType = "(result i32)";
      retVal = "(local.get $scratch)"
    }
  }

  var returnProgram = `
  (module
    (func $print_num (import "imports" "print_num") (param i32) (result i32))
    (func $print_bool (import "imports" "print_bool") (param i32) (result i32))
    (func $print_none (import "imports" "print_none") (param i32) (result i32))
    (func $abs (import "imports" "abs") (param i32) (result i32))
    (func $max (import "imports" "max") (param i32 i32) (result i32))
    (func $min (import "imports" "min") (param i32 i32) (result i32))
    (func $pow (import "imports" "pow") (param i32 i32) (result i32))
    ${varDecls}
    ${funsCode}
    (func (export "_start") ${retType}
      ${main}
      ${retVal}
    )
  ) 
  `;

  return returnProgram;
}

function codeGenVarDefs(varDefs : VarDefs<Type>[], env: LocalEnv) : string[] {

  var compiledDefs:string[] = []; 
  varDefs.forEach(v => {
    compiledDefs = [...compiledDefs,...codeGenLiteral(v.literal, env)];
    if(env.has(v.name)) { compiledDefs.push(`(local.set $${v.name})`); }
    else { compiledDefs.push(`(global.set $${v.name})`); }  

  });
  return compiledDefs;
}

function codeGenFunction(fn : FunDefs<Type>, locals : LocalEnv) : Array<string> {
  // Construct the environment for the function body

  const withParamsAndVariables = new Map<string, boolean>(locals.entries());
  fn.params.forEach(p => withParamsAndVariables.set(p.name, true));
  const params = fn.params.map(p => `(param $${p.name} i32)`).join(" ");

  const varDecls = fn.body1.map(v => `(local $${v.name} i32)`).join("\n");
  fn.body1.forEach(v => withParamsAndVariables.set(v.name, true));
  const varDefs = varDecls.concat(codeGenVarDefs(fn.body1, withParamsAndVariables).join("\n"));
  
  const stmts = fn.body2.map(s => codeGenStmt(s, withParamsAndVariables)).flat();
  const stmtsBody = stmts.join("\n");

  return [`(func $${fn.name} ${params} (result i32)
    (local $scratch i32)
    ${varDefs}
    ${stmtsBody}
    (i32.const 0))`];
}

function codeGenStmt(stmt: Stmt<Type>, locals : LocalEnv) : Array<string> {
  switch(stmt.tag) {
    case "pass":
      //TODO : Check if anything else needs to be included
      return [];

    case "assign":
      var valStmts = codeGenExpr(stmt.value, locals);
      if(locals.has(stmt.name)) { valStmts.push(`(local.set $${stmt.name})`); }
      else { valStmts.push(`(global.set $${stmt.name})`); }
      return valStmts;

    case "expr":
      var result = codeGenExpr(stmt.expr, locals);
      result.push("(local.set $scratch)");
      return result;

    case "return":
      var result = codeGenExpr(stmt.value, locals);
      result.push("return")
      return result;

    case "ifElse":
      var cond_code = codeGenExpr(stmt.cond, locals);
      var then_code = codeGenStmts(stmt.then, locals);
      var else_code = codeGenStmts(stmt.else, locals);

      let if_code:string[]= cond_code.concat([`(if`]).concat([`(then`])
      if_code = if_code.concat(then_code).concat([`)`])

      if (else_code.length > 0) {
        if_code = if_code.concat(['(else']).concat(else_code).concat([')',')'])
      }
      else {
        if_code = if_code.concat([`)`])
      }
      return if_code

    case "while":
      var while_cond = codeGenExpr(stmt.cond, locals);
      var then_code = stmt.then.map((s) => codeGenStmt(s, locals)).flat();
      return ["(block (loop (br_if 1"]
        .concat(while_cond)
        .concat(["(i32.eqz))"])
        .concat(then_code)
        .concat(["(br 0) ))"]);
  }
}

function codeGenStmts(stmts: Stmt<Type>[], env: LocalEnv) : Array<string> {
  let stmts_code:string[] = []
  stmts.forEach(stmt => {
    stmts_code = stmts_code.concat(codeGenStmt(stmt, env))
  })
  return stmts_code
}

export function codeGenLiteral(literal : Literal<Type>, locals : LocalEnv) {
  switch(literal.tag){
    case "num" : return ["(i32.const " + literal.value + ")"];
    case "bool": 
      if(literal.value) 
        return [`(i32.const 1)`];
      else 
        return [`(i32.const 0)`]; 
    case "none":
      return [`(i32.const 0)`]; 
  }
}

export function codeGenBinaryOp(op : BinaryOp) {
  switch(op) {
    case BinaryOp.Plus: return [`(i32.add)`];
    case BinaryOp.Minus: return [`(i32.sub)`];
    case BinaryOp.Mul: return [`(i32.mul)`];
    case BinaryOp.D_slash: return [`(i32.div_s)`];
    case BinaryOp.Mod: return [`(i32.rem_s)`];
    case BinaryOp.Gt: return [`(i32.gt_s)`];
    case BinaryOp.Geq: return [`(i32.ge_s)`];
    case BinaryOp.Lt: return [`(i32.lt_s)`];
    case BinaryOp.Leq: return [`(i32.le_s)`];
    case BinaryOp.Eq: return [`(i32.eq)`];
    case BinaryOp.Neq: return [`(i32.ne)`];
    case BinaryOp.Is: return [`(i32.eq)`];
    default:
      throw new Error(`Unhandled or unknown op: ${op}`);
  }
}

export function codeGenExpr(expr : Expr<Type>, locals : LocalEnv) : Array<string> {
  switch(expr.tag) {
    case "literal": return codeGenLiteral(expr.literal, locals);
    case "id":
      if(locals.has(expr.name)) { return [`(local.get $${expr.name})`]; }
      else { return [`(global.get $${expr.name})`]; }
    case "builtin1":
        const argStmts = codeGenExpr(expr.arg , locals);
        return argStmts.concat([`(call $${expr.name})`]);
    case "builtin2":
        const argStmts1 = codeGenExpr(expr.arg1 , locals);
        const argStmts2 = codeGenExpr(expr.arg2, locals);
        return [...argStmts1, ...argStmts2, `(call $${expr.name})`]; 
    case "binExpr": {
      const lhsExprs = codeGenExpr(expr.left, locals);
      const rhsExprs = codeGenExpr(expr.right, locals);
      const opstmts = codeGenBinaryOp(expr.op);
      return [...lhsExprs, ...rhsExprs, ...opstmts];
    }
    case "unExpr":
      const exprStmts = codeGenExpr(expr.right, locals);
      switch (expr.op) {
        case UnaryOp.U_Minus:
          return [`(i32.const 0)`].concat(exprStmts).concat([`(i32.sub)`]);
        case UnaryOp.Not:
          return exprStmts.concat([`(i32.const 1)`, `(i32.xor)`]);
        case UnaryOp.U_Plus:
          return [`(i32.const 0)`].concat(exprStmts).concat([`(i32.add)`]);
      }
    case "call":
      const valStmts = expr.args.map(e => codeGenExpr(e, locals)).flat();
      let callName = expr.name;
      if(expr.name === "print") {
        switch(expr.args[0].a) {
          case Type.bool: callName = "print_bool"; break;
          case Type.int: callName = "print_num"; break;
          case Type.none: callName = "print_none"; break;
        }
      }
      valStmts.push(`(call $${callName  })`);
      return valStmts;

  }
}
