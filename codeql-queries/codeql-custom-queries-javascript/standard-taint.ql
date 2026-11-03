/**
 * @name Effect provenance: standard-taint
 * @kind table
 * @id custom/effect-standard-taint
 */
import Provenance

module Config implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { candidateSource(n) }
  predicate isSink(DataFlow::Node n) { dependency(_, _, n) }
  predicate neverSkip(DataFlow::Node n) { projectNode(n) }
 }
module Flow = TaintTracking::Global<Config>;

query predicate pathNodes(Flow::PathNode p, string entity, string context) {
  entity = entityId(p.getNode()) and context = p.toStringWithContext()
}
query predicate pathEdges(Flow::PathNode a, Flow::PathNode b, string kind, string provenance) {
  Flow::PathGraph::edges(a, b, _, provenance) and kind = transition(a.getNode(), b.getNode())
}
query predicate subpaths(Flow::PathNode arg, Flow::PathNode par, Flow::PathNode ret, Flow::PathNode out) {
  Flow::PathGraph::subpaths(arg, par, ret, out)
}
from Effect e, int index, DataFlow::Node entry, Flow::PathNode source, Flow::PathNode sink
where dependency(e, index, entry) and Flow::flowPath(source, sink) and sink.getNode() = entry
select entityId(e) as effect, index, source, sink

