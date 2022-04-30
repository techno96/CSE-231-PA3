import {compile, run} from './compiler';

document.addEventListener("DOMContentLoaded", async () => {
  function display(arg : string) {
    const elt = document.createElement("pre");
    document.getElementById("output").appendChild(elt);
    elt.innerText = arg;
  }
  var memory = new WebAssembly.Memory({initial:3000, maximum:3000});
  var importObject = {
    imports: {
      print_num: (arg : any) => {
        console.log("Logging from WASM: ", arg);
        display(String(arg));
        return arg;
      },
      print_bool: (arg : any) => {
        if(arg === 0) { display("False"); }
        else { display("True"); }
        return arg;
      },
      print_none: (arg: any) => {
        display("None");
        return arg;
      },
      abs: Math.abs,
      max: Math.max,
      min: Math.min,
      pow: Math.pow,
    },
    js : {
      memory : memory
    }
  };
  const runButton = document.getElementById("run");
  const userCode = document.getElementById("user-code") as HTMLTextAreaElement;
  runButton.addEventListener("click", async () => {
    const program = userCode.value;
    const output = document.getElementById("output");
    output.textContent = ""
    try {
      const wat = compile(program);
      console.log(wat)
      const code = document.getElementById("generated-code");
      code.textContent = wat;
      const result = await run(wat, importObject);
      // output.textContent += String(result);
      output.setAttribute("style", "color: black");
    }
    catch(e) {
      console.error(e)
      output.textContent = String(e);
      output.setAttribute("style", "color: red");
    }
  });

  userCode.value = localStorage.getItem("program");
  userCode.addEventListener("keypress", async() => {
    localStorage.setItem("program", userCode.value);
  });
});