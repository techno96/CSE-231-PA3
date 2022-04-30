import { BinaryOp, Expr, MethodDefs, Literal, Program, Stmt, Type, TypedVar, UnaryOp, VarDefs, ClassDefs } from "./ast";

type ClassData = {
    vars : Map<string, Type>,
    methods : Map<string, [Type[], Type]>
}

type TypeEnv = {
    vars : Map<string, Type>,
    functions : Map<string, [Type[], Type]>,
    retType : Type,
    classes: Map<string, ClassData>
}

function assignableTo(formal: Type, actual: Type) : Boolean {
    console.log(formal)
    console.log(actual)
    if (formal === "int" || formal === "bool" || formal === "none")
        if (formal === actual)
            return true;

    //@ts-ignore            
    if (formal.tag === "object" && actual.tag === "object" && formal.class === actual.class)
        return true;
    
    return false;
}

export function typeCheckExpr(expr : Expr<null>, typeEnv : TypeEnv, className : string) : Expr<Type> {
    switch(expr.tag) {
        case "methodCall":
            const lhsExpr = typeCheckExpr(expr.lhs, typeEnv, className);
            if (lhsExpr.a === "int" || lhsExpr.a === "bool" || lhsExpr.a === "none")
                throw new Error("TYPE ERROR: Non-object type in method call")
            if (!typeEnv.classes.has(lhsExpr.a.class))
                throw new Error("TYPE ERROR: No such class exists")

            var classData = typeEnv.classes.get(lhsExpr.a.class)
            if (!classData.methods.has(expr.name))
                throw new Error("TYPE ERROR: No such method")
            
            const rhsExpr = expr.rhs.map(a => typeCheckExpr(a, typeEnv, className));
            const [argTyps, retType] = classData.methods.get(expr.name)
            if (argTyps.length !== rhsExpr.length)
                throw new Error("TYPE ERROR: Argument length mismatch")

            argTyps.forEach((t,i) => {
                if (!assignableTo(t, rhsExpr[i].a))
                    throw new Error("TYPE ERROR: Mismatched Arg types")

            });
            return {...expr, lhs: lhsExpr, rhs: rhsExpr, a: retType}

        case "getField":
            console.log(expr)
            const objExpr = typeCheckExpr(expr.obj, typeEnv, className);
            console.log(objExpr)
            if (objExpr.a === "int" || objExpr.a === "bool" || objExpr.a === "none")
                throw new Error("TYPE ERROR: Non-object type in getField call")
            if (!typeEnv.classes.has(objExpr.a.class))
                throw new Error("TYPE ERROR: No such class exists")

            var classData = typeEnv.classes.get(objExpr.a.class)
            if (!classData.vars.has(expr.name))
                throw new Error("TYPE ERROR: No such field")

            return {...expr, obj : objExpr, a: classData.vars.get(expr.name)}
            
        case "call":
            if (expr.name === "print") {
                if (expr.args.length !== 1) { 
                    throw new Error("TYPE ERROR: print expects a single argument"); 
                }
                const newArgs = [typeCheckExpr(expr.args[0], typeEnv, className)];
                const res : Expr<Type> = {...expr, a: "none", args: newArgs };
                return res;
            }

            if (!typeEnv.functions.has(expr.name)) {
                throw new Error(`TYPE ERROR: function ${expr.name} not found`);
            }
            
            const [args, ret] = typeEnv.functions.get(expr.name);
            if (args.length !== expr.args.length) {
                throw new Error(`TYPE ERROR: Expected ${args.length} arguments but got ${expr.args.length}`);
            }
            
            const newArgs = args.map((a, i) => {
                const argtyp = typeCheckExpr(expr.args[i], typeEnv, className);
                if(a !== argtyp.a) { throw new Error(`TYPE ERROR: Got ${argtyp} as argument ${i + 1}, expected ${a}`); }
                return argtyp
              });
        
            return {...expr, a: ret, args: newArgs };
       
        case "literal": 
            const lit = typeCheckLiteral(expr.literal); 
            return {...expr, a: lit.a, literal: lit};

        case "id":
            if (expr.name === "self" && className !== null && className !== "") {
                return {...expr, a: {tag: "object", class: className}};
            } else if (expr.name === "self") {
                throw new Error("TYPE ERROR: Self usage outside class")
            }
            if (!typeEnv.vars.has(expr.name)) {
                throw new Error("TYPE ERROR: unbound id");
            }
            const idType = typeEnv.vars.get(expr.name);
            return {...expr, a:idType};

        case "builtin2":
            const arg1 = typeCheckExpr(expr.arg1, typeEnv, className);
            const arg2 = typeCheckExpr(expr.arg2, typeEnv, className);
            if (arg1.a !== "int" && arg2.a !== "int") {
                throw new Error("TYPE ERROR: Expression does not evaluate to int");
            }
            return {...expr, a: "int", arg1, arg2}; 

        case "builtin1":
            const arg = typeCheckExpr(expr.arg, typeEnv, className);
            if (arg.a !== "int") {
                throw new Error("TYPE ERROR: Expression does not evaluate to int");
            }
            return {...expr, a: "int", arg}; 
        
        case "binExpr":
            const left = typeCheckExpr(expr.left, typeEnv, className);
            const right = typeCheckExpr(expr.right, typeEnv, className);
            switch(expr.op) {
                case BinaryOp.Plus:
                case BinaryOp.Minus:
                case BinaryOp.Mul:
                case BinaryOp.D_slash:
                case BinaryOp.Mod:
                    if (left.a !== "int" && right.a !== "int") {
                        throw new Error("TYPE ERROR: Expression does not evaluate to int");
                    }
                    return {...expr, a: "int", left, right}; 
                
                case BinaryOp.Leq:
                case BinaryOp.Geq:
                case BinaryOp.Gt:
                case BinaryOp.Lt:    
                    if (left.a !== "int" && right.a !== "int") {
                        throw new Error("TYPE ERROR: Expression does not evaluate to int");
                    }
                    return {...expr, a: "bool", left, right}; 

                case BinaryOp.Eq:
                case BinaryOp.Neq:
                    if (left.a == "int" && right.a == "int") {
                        // returning bool as we are checking equals 
                        return {...expr, a: "bool", left, right}; 
                    }
                    
                    if (left.a == "bool" && right.a == "bool") {
                        return {...expr, a: "bool", left, right}; 
                    }

                    // Do we have to handle None also here ?
                    throw new Error("TYPE ERROR: LHS and RHS do not evaluate to the same types");

                case BinaryOp.Is:
                    //check none and return boolean
                    if (validIsType(left.a) && validIsType(right.a)) {
                        return {...expr, a: "bool"}; 
                    } 

                    throw new Error("TYPE ERROR: Incompatible types using Is operator");

                default:
                    throw new Error(`Unhandled op`)
            }

        case "unExpr":
            const rt = typeCheckExpr(expr.right, typeEnv, className);
            switch(expr.op) {
                case UnaryOp.Not:
                    if (rt.a !== "bool") {
                        throw new Error("TYPE ERROR: Expression does not evaluate to bool");
                    } 
                    return {...expr, a: "bool", right:rt};
                case UnaryOp.U_Minus:
                case UnaryOp.U_Plus:
                    if (rt.a !== "int") {
                        throw new Error("TYPE ERROR: Expression does not evaluate to int");
                    } 
                    return {...expr, a: "int", right:rt};
            }

        default:
            throw new Error("TYPE ERROR: Undefined expression type");
    }
}

function validIsType(type : Type) : Boolean {
    return type === "none";
}

export function typeCheckLiteral(literal : Literal<null>) : Literal<Type> {
    switch(literal.tag) {
        case "num": return {...literal, a: "int"};
        case "bool": return {...literal, a: "bool"};
        case "none": return {...literal, a: "none"};
    }
}

export function typeCheckVarDefs(defs: VarDefs<null>[], typeEnv: TypeEnv) : VarDefs<Type>[] {
    const typedVarDefs : VarDefs<Type>[] = [];
    defs.forEach(def => {
        const typedDef = typeCheckLiteral(def.literal);
        if (def.type !== "int" && def.type !== "bool" && def.type !== "none") {
            if (!(def.type.tag === "object" && typeEnv.classes.has(def.type.class) && typedDef.a === "none")) {
                throw new Error("TYPE ERROR: Object definition does not have consistent types");
            }
        } else if (typedDef.a !== def.type) {
            throw new Error("TYPE ERROR: Variable definition does not have consistent types");
        }
        typedVarDefs.push({...def, a: def.type, literal : typedDef});
        typeEnv.vars.set(def.name, def.type);
    });

    return typedVarDefs;
}

export function typeCheckTypedVars(vars: TypedVar<null>[]) : TypedVar<Type>[] {
    return vars.map(variable => {
        return {...variable, a: variable.type}
    });
}

function duplicateEnv(env : TypeEnv) : TypeEnv {
    return  { vars : new Map(env.vars), functions : new Map(env.functions), retType : env.retType, classes: new Map(env.classes)}
}

export function typeCheckStmts(stmts: Stmt<null>[], env : TypeEnv, className : string) : Stmt<Type>[] {
    const typedStmts : Stmt<Type>[] = [];
    stmts.forEach(stmt => {
        switch(stmt.tag) {
            case "setField":
                const lhsExpr = typeCheckExpr(stmt.lhs, env, className);
                if (lhsExpr.a === "int" || lhsExpr.a === "bool" || lhsExpr.a === "none")
                    throw new Error("TYPE ERROR: Non-object type in getField call")
                if (!env.classes.has(lhsExpr.a.class))
                    throw new Error("TYPE ERROR: No such class exists")

                var classData = env.classes.get(lhsExpr.a.class)
                console.log(classData)
                console.log(stmt.name)
                if (!classData.vars.has(stmt.name))
                    throw new Error("TYPE ERROR: No such field")

                const rhsExpr = typeCheckExpr(stmt.rhs, env, className);
                //@ts-ignore
                if (!assignableTo(classData.vars.get(stmt.name), rhsExpr.a))
                    throw new Error("TYPE ERROR: Incompatible types in setField statement")
                
                typedStmts.push({...stmt, a: "none", lhs: lhsExpr, rhs:rhsExpr})
                break;
            case "expr":
                const typedExpr = typeCheckExpr(stmt.expr, env, className);
                typedStmts.push({...stmt, a: "none", expr: typedExpr});
                break;
            case "pass":
                typedStmts.push({...stmt, a: "none"});
                break;
            case "assign":
                console.log(stmt.name)
                if (!env.vars.has(stmt.name)) 
                    throw new Error("TYPE ERROR: unbound id");
                const typExpr = typeCheckExpr(stmt.value, env, className);

                var stmtType = env.vars.get(stmt.name)
                //@ts-ignore
                if (stmtType.tag === "object") {
                    //@ts-ignore
                    if ((env.classes.has(stmtType.class) && typExpr.a === "none") || assignableTo(stmtType, typExpr.a))
                        typedStmts.push({...stmt, value: typExpr, a: "none"});
                    else {
                        throw new Error("TYPE ERROR: LHS and RHS have incompatible types");
                    }
                } else if (typExpr.a !== env.vars.get(stmt.name)) {
                    throw new Error("TYPE ERROR: LHS and RHS have incompatible types");
                } else {
                    typedStmts.push({...stmt, value: typExpr, a: "none"});
                }
                
                break;
            case "return":
                const newExpr = typeCheckExpr(stmt.value, env, className);
                if (newExpr.a !== env.retType) {
                    throw new Error(`TYPE ERROR: ${newExpr} returned but ${env.retType} expected.`);
                }
                typedStmts.push({...stmt, value: newExpr, a: "none"});
                break;

            case "ifElse":
                const cond = typeCheckExpr(stmt.cond, env, className);
                if (cond.a !== "bool") {
                    throw new Error('TYPE ERROR: Condition should evaluate to a boolean')
                }
                const typedThenStmts = typeCheckStmts(stmt.then, env, className);
                const typedElseStmts = typeCheckStmts(stmt.else, env, className);
                typedStmts.push({...stmt, cond, then: typedThenStmts, else: typedElseStmts});
                break;
            
            case "while":
                const condition = typeCheckExpr(stmt.cond, env, className);
                if (condition.a !== "bool") {
                    throw new Error('TYPE ERROR: Condition should evaluate to a boolean')
                }
                const typedLoopStmts = typeCheckStmts(stmt.then, env, className);
                typedStmts.push({...stmt, cond: condition, then: typedLoopStmts});
                break;

            default:
                throw new Error("TYPE ERROR: Unknown statement type");
        }
    })
    return typedStmts;
}


export function typeCheckMethodDef(method: MethodDefs<null>, typeEnv : TypeEnv, classData : ClassData, className : string): MethodDefs<Type> {

    //set class data
    const localEnv = duplicateEnv(typeEnv);

    const typedParams = typeCheckTypedVars(method.params);
    method.params.forEach(p => {
        localEnv.vars.set(p.name, p.type);
    });

    //TODO :  Double check if we need to add it to global env
    const typedVarDefs = typeCheckVarDefs(method.body1, localEnv);

    //Add function to env for recursion support
    localEnv.functions.set(method.name, [method.params.map(param => param.type), method.ret])
    localEnv.retType = method.ret;

    const typedStmts = typeCheckStmts(method.body2, localEnv, className);
    classData.methods.set(method.name, [typedParams.map(param => param.type), method.ret])
    return {...method, a: method.ret, params: typedParams, body2: typedStmts, body1: typedVarDefs}
    
}

export function typeCheckClassDef(classDef: ClassDefs<null>, env : TypeEnv, classData : ClassData) : ClassDefs<Type> {

    const typedFields = typeCheckVarDefs(classDef.fields, env);
    typedFields.forEach(field => {
        classData.vars.set(field.name, field.type)
    })
    env.classes.set(classDef.name, classData)

    var typedMethods:MethodDefs<Type>[] = [];
    env.functions.set(classDef.name, [[], "none"])
    classDef.methods.forEach(m => {
        const typedMethod = typeCheckMethodDef(m, env, classData, classDef.name)
        classData.methods.set(m.name, [typedMethod.params.map(param => param.type), m.ret])
        typedMethods.push(typedMethod);
    });

    return {...classDef, a: "none", fields: typedFields , methods: typedMethods}
}

function createNewEnv() : TypeEnv {
    return  { vars : new Map<string, Type>(), 
              functions : new Map<string, ["none"[], "none"]>(), 
              retType : "none",
              classes : new Map<string, ClassData>(), 
        }
}

export function typeCheckProgram(prgm : Program<null>) : Program<Type> {

    var env = createNewEnv();

    prgm.classDefs.forEach(c => {
        var newClassData : ClassData = {vars : new Map<string, Type>(), methods: new Map<string, [Type[], Type]>()}
        env.classes.set(c.name, newClassData);
    });

    var varDefs:VarDefs<Type>[] = typeCheckVarDefs(prgm.varDefs, env);
    varDefs.forEach(def => {
        env.vars.set(def.name, def.type);
        console.log(def.name)
        console.log(def.type)
    })

    var classDefs:ClassDefs<Type>[] = [];
    prgm.classDefs.forEach(c => {
        var classData = { vars : new Map<string, Type>(), methods : new Map<string, ["none"[], "none"]>()}
        const typedClass = typeCheckClassDef(c, env, classData)
        
        env.classes.set(typedClass.name, classData);
        classDefs.push(typedClass);
    });

    var typedStatements = typeCheckStmts(prgm.stmts, env, "")
    return {a: "none", varDefs, classDefs, stmts : typedStatements}

}