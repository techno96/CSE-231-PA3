import {compile, run} from './compiler';
const importObject = {
  imports: {
    print_num: (arg : any) => {
      console.log(arg);
      return arg;
    },
    print_bool: (arg : any) => {
      if(arg !== 0) { console.log("True"); }
      else { console.log("False"); }
    },
    print_none: (arg : any) => {
      console.log("None");
    },
    abs: Math.abs,
    max: Math.max,
    min: Math.min,
    pow: Math.pow
  },
  output: ""
};
const input = process.argv[2];
const result = compile(input);
console.log(result);
run(result, importObject).then((value) => {
  console.log(value);
});

