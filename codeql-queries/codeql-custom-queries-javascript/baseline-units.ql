/**
 * @name Baseline projection onto dependency-position/source-position units
 * @kind table
 * @id custom/effect-baseline-units
 */
import Provenance

predicate immediateSource(Variable variable, Variable source) {
  exists(Expr assigned, VarRef ref |
    assigned = variable.getAnAssignedExpr() and
    not assigned.(CallExpr).getCalleeName() in ["useEffectEvent", "useStableCallback"] and
    ref.getParent*() = assigned and source = ref.getVariable() and variable != source
  )
}
from CallExpr e, ArrayExpr array, int index, VarRef ref, Variable variable, DataFlow::Node n
where
  e.getCalleeName() = "useEffect" and array = e.getArgument(1) and
  ref.getParent*() = array.getElement(index) and
  immediateSource*(ref.getVariable(), variable) and
  (
    n = variable.getAnAssignedExpr().flow()
    or not exists(variable.getAnAssignedExpr()) and n = variable.getADeclaration().flow()
  ) and
  candidateSource(n)
select entityId(e.flow()) as effect, index, entityId(n) as source

