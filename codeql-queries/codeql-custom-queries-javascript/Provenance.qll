import javascript
import semmle.javascript.ApiGraphs
import semmle.javascript.frameworks.React
import semmle.javascript.dataflow.TaintTracking

/** Only project files are eligible for exported source positions. */
predicate projectNode(DataFlow::Node n) {
  not n.getFile().getRelativePath().matches("%node_modules/%") and
  not n.getFile().getRelativePath().matches("%node_modules\\%") and
  not n.getFile().getRelativePath().matches("%codeql-db/%") and
  n.getStartLine() > 0
}

predicate reactCall(DataFlow::CallNode call, string name) {
  call = API::moduleImport("react").getMember(name).getACall()
}

class Effect extends DataFlow::CallNode {
  Effect() { reactCall(this, "useEffect") and projectNode(this) }
  string getMode() {
    not exists(this.getArgument(1)) and result = "absent"
    or
    exists(ArrayExpr a | a = this.getArgument(1).asExpr() |
      if a.getSize() > 0
      then
        if exists(a.getElement(_).(SpreadElement)) or a.hasOmittedElement()
        then result = "unsupported"
        else result = "literal"
      else result = "empty"
    )
    or
    exists(this.getArgument(1)) and
    not this.getArgument(1).asExpr() instanceof ArrayExpr and result = "unsupported"
  }
}

predicate dependency(Effect effect, int index, DataFlow::Node entry) {
  effect.getMode() = "literal" and
  entry = effect.getArgument(1).asExpr().(ArrayExpr).getElement(index).flow()
}

/** A state slot, rather than the tuple or setter identity. */
predicate stateSlot(DataFlow::Node n, DataFlow::CallNode hook) {
  reactCall(hook, "useState") and n = hook.getAPropertyRead("0")
}

predicate unknownCall(DataFlow::Node n) {
  n instanceof DataFlow::InvokeNode and
  not exists(n.(DataFlow::InvokeNode).getACallee()) and
  not reactCall(n.(DataFlow::CallNode), ["useState", "useMemo", "useCallback", "useEffectEvent", "useRef", "useContext"])
}

string nodeKind(DataFlow::Node n) {
  stateSlot(n, _) and result = "react-state"
  or
  not stateSlot(n, _) and (
    unknownCall(n) and result = "unknown-call"
    or
    not unknownCall(n) and (
      n.asExpr() instanceof Literal and result = "literal"
      or n instanceof DataFlow::FunctionNode and result = "function-creation"
      or n.asExpr() instanceof ObjectExpr and result = "object-creation"
      or n.asExpr() instanceof ArrayExpr and result = "array-creation"
      or n instanceof DataFlow::ParameterNode and result = "parameter"
      or n instanceof DataFlow::PropRead and result = "property-read"
      or
      not n.asExpr() instanceof Literal and
      not n instanceof DataFlow::FunctionNode and
      not n.asExpr() instanceof ObjectExpr and
      not n.asExpr() instanceof ArrayExpr and
      not n instanceof DataFlow::ParameterNode and
      not n instanceof DataFlow::PropRead and result = "value"
    )
  )
}

predicate candidateSource(DataFlow::Node n) {
  projectNode(n) and
  nodeKind(n) != "value"
}

string position(Location l) {
  result = l.getFile().getRelativePath().replaceAll("\\", "/") + ":" +
    l.getStartLine() + ":" + l.getStartColumn() + ":" + l.getEndLine() + ":" + l.getEndColumn()
}

string entityId(DataFlow::Node n) {
  result = position(n.getLocation()) + "#" + nodeKind(n) + ":" + n.toString()
}

/** Confirmed gap in React.qll 2.10.0: callback identity is not modeled. */
predicate callbackIdentity(DataFlow::Node pred, DataFlow::Node succ) {
  reactCall(succ.(DataFlow::CallNode), ["useCallback", "useEffectEvent"]) and
  pred = succ.(DataFlow::CallNode).getArgument(0)
}

/** Lazy initializer/updater functions are executed, not stored as state identities. */
predicate stateCallback(DataFlow::Node n) {
  exists(DataFlow::CallNode hook | reactCall(hook, "useState") |
    n = hook.getCallback(0) or n = hook.getAPropertyRead("1").getACall().getCallback(0)
  )
}

predicate stateRelation(DataFlow::Node pred, DataFlow::Node succ, string kind) {
  exists(DataFlow::CallNode hook | stateSlot(succ, hook) |
    pred = hook.getArgument(0) and not pred instanceof DataFlow::FunctionNode and kind = "state-initial"
    or pred = [hook.getCallback(0).getReturnNode(), hook.getCallback(0).getAReturn()] and kind = "state-initial"
    or
    exists(DataFlow::CallNode setter | setter = hook.getAPropertyRead("1").getACall() |
      pred = setter.getArgument(0) and not pred instanceof DataFlow::FunctionNode and kind = "state-update"
      or pred = [setter.getCallback(0).getReturnNode(), setter.getCallback(0).getAReturn()] and kind = "state-update-functional"
    )
  )
}

bindingset[a, b]
string transition(DataFlow::Node a, DataFlow::Node b) {
  stateRelation(a, b, result)
  or callbackIdentity(a, b) and result = "callback-identity"
  or
  not stateRelation(a, b, _) and not callbackIdentity(a, b) and (
    b instanceof DataFlow::PropRead and result = "property-read"
    or b instanceof DataFlow::ParameterNode and result = "call-argument"
    or b instanceof DataFlow::InvokeNode and result = "call-return"
    or b.asExpr() instanceof BinaryExpr and result = "transformation"
    or b.asExpr() instanceof UnaryExpr and result = "transformation"
    or
    not b instanceof DataFlow::PropRead and not b instanceof DataFlow::ParameterNode and
    not b instanceof DataFlow::InvokeNode and not b.asExpr() instanceof BinaryExpr and
    not b.asExpr() instanceof UnaryExpr and result = "value-flow"
  )
}

