import { none } from "binaryen";
import { parse } from "../parser";
import { typeCheckProgram } from "../typechecker";
import { importObject } from "./import-object.test";
import wabt from "wabt";
import { compile } from "../compiler";

// Modify typeCheck to return a `Type` as we have specified below
export function typeCheck(source: string) : Type {
  const program = typeCheckProgram(parse(source))
  var return_type : Type = "none";
  var length : number = program.stmts.length;
  if (length > 0) {
    return_type = program.stmts[length - 1].a
  }
  return "none";
}

// Modify run to use `importObject` (imported above) to use for printing
// You can modify `importObject` to have any new fields you need here, or
// within another function in your compiler, for example if you need other
// JavaScript-side helpers
export async function run(source: string) {
  var memory = new WebAssembly.Memory({initial:3000, maximum:3000});
  var newImportObj = {
    imports : importObject.imports,
    js : {memory:memory}
  }

  const watSource = compile(source);
  const wabtApi = await wabt();
  const parsed = wabtApi.parseWat("example", watSource);
  const binary = parsed.toBinary({});
  const wasmModule = await WebAssembly.instantiate(binary.buffer, newImportObj);
  return (wasmModule.instance.exports as any)._start();
}

type Type =
  | "int"
  | "bool"
  | "none"
  | { tag: "object", class: string }

export const NUM : Type = "int";
export const BOOL : Type = "bool";
export const NONE : Type = "none";
export function CLASS(name : string) : Type { 
  return { tag: "object", class: name }
};
