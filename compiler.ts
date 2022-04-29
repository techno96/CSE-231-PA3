import wabt from "wabt";
import { Stmt, Expr, BinaryOp, MethodDefs, Type, VarDefs, Literal, UnaryOp, ClassDefs} from "./ast";
import { parse } from "./parser";
import { typeCheckProgram } from "./typechecker";

// https://learnxinyminutes.com/docs/wasm/

type LocalEnv = Map<string, boolean>;

type ClassEnv = {
  classes : Map<string, ClassDefs<Type>>
}


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
  var emptyClassEnv: ClassEnv = { classes : new Map<string, ClassDefs<Type>>() }

  var varDecls = ast.varDefs.map(v => `(global $${v.name} (mut i32) (i32.const 0))`).join("\n");
  var heapInit = `global $heap (mut i32) (i32.const 4)`
  var varDefs : string[] = codeGenVarDefs(ast.varDefs, emptyEnv);

  ast.classDefs.map(c => emptyClassEnv.classes.set(c.name, c))
  var classesCode : string[] = ast.classDefs.map(c => codeGenClass(c, emptyEnv, emptyClassEnv)).map(c => c.join("\n"));
  classesCode.join("\n\n");
  
  var allStmts = ast.stmts.map(s => codeGenStmt(s, emptyEnv, emptyClassEnv)).flat();
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
    (import "mem" "heap" (memory $0 1))
    (func $print_num (import "imports" "print_num") (param i32) (result i32))
    (func $print_bool (import "imports" "print_bool") (param i32) (result i32))
    (func $print_none (import "imports" "print_none") (param i32) (result i32))
    (func $abs (import "imports" "abs") (param i32) (result i32))
    (func $max (import "imports" "max") (param i32 i32) (result i32))
    (func $min (import "imports" "min") (param i32 i32) (result i32))
    (func $pow (import "imports" "pow") (param i32 i32) (result i32))
    ${varDecls}
    ${heapInit}
    ${classesCode}
    (func (export "_start") ${retType}
      ${main}
      ${retVal}
    )
  ) 
  `;

  return returnProgram;
}

function codeGenClass(classDef : ClassDefs<Type>, env: LocalEnv, classEnv : ClassEnv) : string[] {

  var containsInit = checkInitPresent(classDef)
  var methodCode : string[] = classDef.methods.map(m => codeGenMethod(m, env, classEnv, classDef)).map(m => m.join("\n"));
  if (containsInit === false) {
    methodCode.concat(codeGenInitMethod(classDef))
  }
  methodCode.join("\n\n");

  return methodCode;
}

function checkInitPresent(classDef : ClassDefs<Type>) : Boolean {
  var classMethods : MethodDefs<Type>[] = classDef.methods
  var i = 0
  for (i = 0; i < classMethods.length; i++) {
    if (classMethods[i].name === "__init__") {
      return true;
    }
  }
  return false;
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

function codeGenInitMethod(clazz: ClassDefs<Type>) : string[] {
  var methodName = "__init__"
  return [`(func $${methodName}$${clazz.name} (param $self i32) (result i32)
    (local $scratch i32)
    (local.get $self)
    (return)
    (i32.const 0))`];
}

function codeGenMethod(method : MethodDefs<Type>, locals : LocalEnv, classEnv : ClassEnv, clazz: ClassDefs<Type>) : Array<string> {
  // Construct the environment for the function body

  const withParamsAndVariables = new Map<string, boolean>(locals.entries());
  method.params.forEach(p => withParamsAndVariables.set(p.name, true));
  const params = method.params.map(p => `(param $${p.name} i32)`).join(" ");

  const varDecls = method.body1.map(v => `(local $${v.name} i32)`).join("\n");
  method.body1.forEach(v => withParamsAndVariables.set(v.name, true));
  const varDefs = varDecls.concat(codeGenVarDefs(method.body1, withParamsAndVariables).join("\n"));
  
  const stmts = method.body2.map(s => codeGenStmt(s, withParamsAndVariables, classEnv)).flat();
  const stmtsBody = stmts.join("\n");

  if (method.name === "__init__") {
    return [`(func $${method.name}$${clazz.name} ${params} (result i32)
    (local $scratch i32)
    ${varDefs}
    ${stmtsBody}
    (local.get $${method.params[0].name})
    (return)
    (i32.const 0))`];
  } else {
    return [`(func $${method.name}$${clazz.name} ${params} (result i32)
    (local $scratch i32)
    ${varDefs}
    ${stmtsBody}
    (i32.const 0))`];
  }
  
}

function codeGenStmt(stmt: Stmt<Type>, locals : LocalEnv, classEnv: ClassEnv) : Array<string> {
  switch(stmt.tag) {
    case "setField":
      const lhsStmts = codeGenExpr(stmt.lhs, locals, classEnv);
      const rhsStmts = codeGenExpr(stmt.rhs, locals, classEnv);
      //@ts-ignore
      const classData = classEnv.classes.get(stmt.lhs.a.class)
      const fieldIndex = getIndexFromMap(classData, stmt.name)
      return [...lhsStmts, `global.get $heap`, `(i32.add (i32.const ${fieldIndex * 4}))`, ...rhsStmts, `i32.store`]

    case "pass":
      //TODO : Check if anything else needs to be included
      return [];

    case "assign":
      var valStmts = codeGenExpr(stmt.value, locals, classEnv);
      if(locals.has(stmt.name)) { valStmts.push(`(local.set $${stmt.name})`); }
      else { valStmts.push(`(global.set $${stmt.name})`); }
      return valStmts;

    case "expr":
      var result = codeGenExpr(stmt.expr, locals, classEnv);
      result.push("(local.set $scratch)");
      return result;

    case "return":
      var result = codeGenExpr(stmt.value, locals, classEnv);
      result.push("return")
      return result;

    case "ifElse":
      var cond_code = codeGenExpr(stmt.cond, locals, classEnv);
      var then_code = codeGenStmts(stmt.then, locals, classEnv);
      var else_code = codeGenStmts(stmt.else, locals, classEnv);

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
      var while_cond = codeGenExpr(stmt.cond, locals, classEnv);
      var then_code = stmt.then.map((s) => codeGenStmt(s, locals, classEnv)).flat();
      return ["(block (loop (br_if 1"]
        .concat(while_cond)
        .concat(["(i32.eqz))"])
        .concat(then_code)
        .concat(["(br 0) ))"]);
  }
}

function codeGenStmts(stmts: Stmt<Type>[], env: LocalEnv, classEnv: ClassEnv) : Array<string> {
  let stmts_code:string[] = []
  stmts.forEach(stmt => {
    stmts_code = stmts_code.concat(codeGenStmt(stmt, env, classEnv))
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

export function codeGenExpr(expr : Expr<Type>, locals : LocalEnv, classEnv: ClassEnv) : Array<string> {
  switch(expr.tag) {
    case "literal": return codeGenLiteral(expr.literal, locals);
    case "id":
      if(locals.has(expr.name)) { return [`(local.get $${expr.name})`]; }
      else { return [`(global.get $${expr.name})`]; }
    case "builtin1":
        const argStmts = codeGenExpr(expr.arg , locals, classEnv);
        return argStmts.concat([`(call $${expr.name})`]);
    case "builtin2":
        const argStmts1 = codeGenExpr(expr.arg1 , locals, classEnv);
        const argStmts2 = codeGenExpr(expr.arg2, locals, classEnv);
        return [...argStmts1, ...argStmts2, `(call $${expr.name})`]; 
    case "binExpr": {
      const lhsExprs = codeGenExpr(expr.left, locals, classEnv);
      const rhsExprs = codeGenExpr(expr.right, locals, classEnv);
      const opstmts = codeGenBinaryOp(expr.op);
      return [...lhsExprs, ...rhsExprs, ...opstmts];
    }
    case "unExpr":
      const exprStmts = codeGenExpr(expr.right, locals, classEnv);
      switch (expr.op) {
        case UnaryOp.U_Minus:
          return [`(i32.const 0)`].concat(exprStmts).concat([`(i32.sub)`]);
        case UnaryOp.Not:
          return exprStmts.concat([`(i32.const 1)`, `(i32.xor)`]);
        case UnaryOp.U_Plus:
          return [`(i32.const 0)`].concat(exprStmts).concat([`(i32.add)`]);
      }
    case "call":
      if (classEnv.classes.has(expr.name)) {
        var initvals:string[] = [];
        const classData = classEnv.classes.get(expr.name)
        var fieldArray = classData.fields
        fieldArray.forEach((v, index) => {
          var offset = index * 4;
          initvals = [...initvals, 
                      `global.get $heap`, 
                      `(i32.add (i32.const ${offset}))`,
                      ...codeGenLiteral(v.literal, locals),
                      `i32.store`
                    ];

        });

        return [...initvals, 
          `global.get $heap`, 
          `(global.set $heap (i32.add (global.get $heap) (i32.const ${fieldArray.length * 4})))`,
          `call $${expr.name + "__init__"}`
        ]
      }
      const valStmts = expr.args.map(e => codeGenExpr(e, locals, classEnv)).flat();
      let callName = expr.name;
      if(expr.name === "print") {
        switch(expr.args[0].a) {
          case "bool": callName = "print_bool"; break;
          case "int": callName = "print_num"; break;
          case "none": callName = "print_none"; break;
        }
      }
      valStmts.push(`(call $${callName  })`);
      return valStmts;

    case "methodCall":
      const lhs_Exprs = codeGenExpr(expr.lhs, locals, classEnv);
      const rhs_Exprs = expr.rhs.map(e => codeGenExpr(e, locals, classEnv)).flat();
      //@ts-ignore
      return [...lhs_Exprs, ...rhs_Exprs, `call $${expr.name}$${expr.lhs.a.class}`]

    case "getField":
      const objStmts = codeGenExpr(expr.obj, locals, classEnv);
      //@ts-ignore
      const classData = classEnv.classes.get(expr.obj.a.class);
      const fieldIndex = getIndexFromMap(classData, expr.name)
      //TODO : Check for Stack 0 and should we use heap here?
      return [...objStmts,`(i32.const ${fieldIndex * 4})`, `i32.add`, `i32.load`]
  }
}

function getIndexFromMap(classData : ClassDefs<Type>, field: string): number {
  var fields = classData.fields
  var i : number = 0
  for(i = 0; i < fields.length; i++) {
    if (fields[i].name === field)
      return i
  }

  return -1

}
