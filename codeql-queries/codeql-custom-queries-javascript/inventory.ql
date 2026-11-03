/**
 * @name React Effect inventory and non-composable annotations
 * @kind table
 * @id custom/effect-inventory
 */
import Provenance

/** Public call inference supplies evidence for checking captured-parameter contexts. */
query predicate callArguments(string argument, string parameter, string site, string target) {
  exists(DataFlow::InvokeNode call, Function f, int index, DataFlow::Node arg, DataFlow::Node par |
    projectNode(call) and f = call.getACallee() and
    arg = call.getArgument(index) and par = DataFlow::parameterNode(f.getParameter(index)) and
    projectNode(arg) and projectNode(par) and
    argument = entityId(arg) and parameter = entityId(par) and
    site = entityId(call) and target = position(f.getLocation()) + "#function"
  )
}
query predicate callReturns(string returned, string site, string target) {
  exists(DataFlow::InvokeNode call, Function f, DataFlow::Node ret |
    projectNode(call) and f = call.getACallee() and
    (ret = f.getAReturnedExpr().flow() or ret = f.flow().(DataFlow::FunctionNode).getReturnNode()) and
    projectNode(ret) and returned = entityId(ret) and
    site = entityId(call) and target = position(f.getLocation()) + "#function"
  )
}

query predicate effects(string id, string location, string mode) {
  exists(Effect e | id = entityId(e) and location = position(e.getLocation()) and mode = e.getMode())
}
query predicate dependencies(string effect, int index, string entry, string location) {
  exists(Effect e, DataFlow::Node n |
    dependency(e, index, n) and effect = entityId(e) and entry = entityId(n) and
    location = position(n.getLocation())
  )
}
query predicate annotations(string parent, string child, string kind, string location) {
  exists(DataFlow::CallNode hook, DataFlow::Node n |
    reactCall(hook, ["useMemo", "useCallback", "useEffectEvent"]) and projectNode(hook) and
    n = hook.getArgument(1).asExpr().(ArrayExpr).getElement(_).flow() and
    parent = entityId(hook) and child = entityId(n) and kind = "hook-dependency" and
    location = position(n.getLocation())
  )
  or
  exists(DataFlow::FunctionNode f, VarRef ref |
    projectNode(f) and ref.getEnclosingFunction() = f.getFunction() and
    not ref.getVariable().getADeclaration().getEnclosingFunction() = f.getFunction() and
    parent = entityId(f) and child = entityId(ref.flow()) and kind = "closure-capture" and
    location = position(ref.getLocation())
  )
}
from DataFlow::Node n
where projectNode(n)
select entityId(n) as id, position(n.getLocation()) as location, nodeKind(n) as kind,
  n.toString() as label

