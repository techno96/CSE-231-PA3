1. Give three examples of Python programs that use binary operators and/or builtins from this PA, but have different behavior than your compiler. 
For each, write: a sentence about why that is, a sentence about what you might do to extend the compiler to support it


pow(0, -99) returns "ZeroDivisionError: 0.0 cannot be raised to a negative power" on Python interpreter but in this compiler it returns 0. 
Similarly, pow(2, -2) returns 0.25 in the Python interpreter, but here is returned as 0 and abs(0.25) returns 0.25 on the interpreter, but 
'invalid literal "0.25"' on this compiler. This is due to the fact that we are processing on 32 bit integers in this compiler but python 
supports the entire universe of data types and 64 bit operations as well. We can extend the compiler to include other datatypes as well and handle overflow and underflow as well.  


2**4 on python interpreter returns 16 but in this compiler, it returns 'Error: PARSE ERROR: unknown binary operator'. This is because the current
parser does not recognize a special operation for ** in this compiler. We need to extend support in the parser to include this case as well. 

max(print(1), print(2)) on the python interpreter prints 1 and 2 but then errors out with 'TypeError: '>' not supported between instances of 'NoneType' and 'NoneType''.
But in this compiler, it prints 1 and 2 and then compares the 2 values and prints 2 again. This is because it takes the argList as 1 and 2 for the max 
expression and thus evaluates them based on that. We will have to introduce a check for such cases in the parser. 

Trying to print x without initialization here returns 'Error: REFERENCE ERROR : undefined local variable' but on the Python interpreter it returns 
'NameError: name 'y' is not defined'. We need to modify the error messages for compatibility.

[This compiler also supports unary negation for variables : like x = 5 print(-x) or print(--x)]

2. What resources did you find most helpful in completing the assignment?
Piazza, TA videos.

3. Who (if anyone) in the class did you work with on the assignment? (See collaboration below)
TAs, Sruthi Praveen Kumar Geetha, Divija Devarla.