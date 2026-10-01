/**
 * @name useEffect dependency graph
 * @description Shows every useEffect dependency and recursively follows the variables used to produce it.
 * @kind graph
 * @id custom/use-effect-dependency-graph
 */

import javascript

/** A call to `useEffect` with an array literal as its second argument. */
predicate useEffectCall(CallExpr effect, ArrayExpr dependencies) {
  effect.getCalleeName() = "useEffect" and
  dependencies = effect.getArgument(1)
}

/**
 * A variable referenced by one of the expressions in an effect's dependency
 * array. This also handles entries such as `object.property` and `a + b`, not
 * only entries that consist of a single variable reference.
 */
predicate directEffectDependency(CallExpr effect, Variable dependency) {
  exists(ArrayExpr dependencies, Expr entry, VarRef reference |
    useEffectCall(effect, dependencies) and
    entry = dependencies.getElement(_) and
    reference.getParent*() = entry and
    dependency = reference.getVariable()
  )
}

/** A local variable initialized directly by one of the callback hooks. */
predicate callbackHookCall(Variable callback, CallExpr hook) {
  hook = callback.getAnAssignedExpr() and
  hook.getCalleeName() in ["useEffectEvent", "useStableCallback"]
}

/** An Effect Event called from inside an effect's callback. */
predicate calledEffectEvent(CallExpr effect, CallExpr hook) {
  exists(Variable callback, CallExpr invocation, VarRef reference |
    useEffectCall(effect, _) and
    callbackHookCall(callback, hook) and
    hook.getCalleeName() = "useEffectEvent" and
    reference.getVariable() = callback and
    invocation.getCallee() = reference and
    reference.getParent*() = effect.getArgument(0)
  )
}

/** A variable from outside the callback, used inside its function body. */
predicate callbackCapture(CallExpr hook, Variable capture) {
  exists(Expr callback, VarRef reference |
    callback = hook.getArgument(0) and
    reference.getParent*() = callback and
    capture = reference.getVariable() and
    not capture.getADeclaration().getParent*() = callback
  )
}

/**
 * A direct source variable of `variable`.
 *
 * For example, both `makeQuery` and `userId` are sources of `query` in:
 *
 *     const query = makeQuery(userId)
 *
 * Searching below the complete assigned expression also covers nested calls,
 * object/array literals, template strings, and arrow/function expressions.
 */
predicate immediateSource(Variable variable, Variable source) {
  exists(Expr assigned, VarRef reference |
    assigned = variable.getAnAssignedExpr() and
    not callbackHookCall(variable, _) and
    reference.getParent*() = assigned and
    source = reference.getVariable() and
    variable != source
  )
}

/** A dependency of `effect`, including transitive sources of array entries. */
predicate effectDependency(CallExpr effect, Variable dependency) {
  directEffectDependency(effect, dependency)
  or
  exists(Variable direct |
    directEffectDependency(effect, direct) and
    immediateSource+(direct, dependency)
  )
}

/** Use a variable's declaration as its graph node. */
predicate variableNode(AstNode node, Variable variable) {
  exists(CallExpr effect |
    effectDependency(effect, variable) and
    node = variable.getADeclaration()
  )
  or
  exists(CallExpr hook |
    callbackInGraph(hook) and
    callbackCapture(hook, variable) and
    node = variable.getADeclaration()
  )
}

/** Callback hook calls reachable from an effect in this graph. */
predicate callbackInGraph(CallExpr hook) {
  calledEffectEvent(_, hook)
  or
  exists(CallExpr effect, Variable callback |
    effectDependency(effect, callback) and
    callbackHookCall(callback, hook) and
    hook.getCalleeName() = "useStableCallback"
  )
}

query predicate nodes(AstNode node, string key, string value) {
  (
    exists(ArrayExpr dependencies |
      useEffectCall(node.(CallExpr), dependencies)
    ) and
    key = "semmle.label" and
    value =
      "useEffect [" + node.getFile().getRelativePath() + ":" + node.getStartLine().toString() + "]"
  )
  or
  (
    callbackInGraph(node.(CallExpr)) and
    key = "semmle.label" and
    value = node.(CallExpr).getCalleeName() + " [" + node.getFile().getRelativePath() + ":" +
      node.getStartLine().toString() + "]"
  )
  or
  exists(Variable variable |
    variableNode(node, variable) and
    key = "semmle.label" and
    value =
      variable.getName() + " [" + node.getFile().getRelativePath() + ":" +
      node.getStartLine().toString() + "]"
  )
}

from AstNode parent, AstNode child
where
  // useEffect -> each variable named in its dependency array
  exists(CallExpr effect, Variable dependency |
    parent = effect and
    directEffectDependency(effect, dependency) and
    child = dependency.getADeclaration()
  )
  or
  // dependency variable -> variables found in its assigned expression
  exists(CallExpr effect, Variable variable, Variable source |
    effectDependency(effect, variable) and
    immediateSource(variable, source) and
    parent = variable.getADeclaration() and
    child = source.getADeclaration()
  )
  or
  // an Effect Event is invoked by the effect without becoming a dependency
  exists(CallExpr effect, CallExpr hook |
    calledEffectEvent(effect, hook) and
    parent = effect and
    child = hook
  )
  or
  // a stable callback in the dependency array is created by its hook call
  exists(CallExpr effect, Variable callback, CallExpr hook |
    effectDependency(effect, callback) and
    callbackHookCall(callback, hook) and
    hook.getCalleeName() = "useStableCallback" and
    parent = callback.getADeclaration() and
    child = hook
  )
  or
  // callback captures are non-reactive; render them as a distinct edge type
  exists(CallExpr hook, Variable capture |
    callbackInGraph(hook) and
    callbackCapture(hook, capture) and
    parent = hook and
    child = capture.getADeclaration()
  )
select parent, child
