import { compile } from "./compiler";
import { parse } from "./parser";

var output = compile("def f(x:int)-> int:\n\ty:int = 10\n\treturn y\nf(20)");
console.log(output);
console.log("hello");