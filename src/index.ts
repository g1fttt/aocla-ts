import { Context } from "./vm.ts"

const vmCtx = new Context()
vmCtx.eval('"Hello, World!\n" print')
