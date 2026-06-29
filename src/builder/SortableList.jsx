// =============================================================================
// src/builder/SortableList.jsx
//
// A reusable vertical sortable list, built on dnd-kit (the library chosen in
// Phase 0 for sortable / nested structures: report field lists, page-layout
// sections, dashboard filters). react-grid-layout owns the free-positioned
// CANVAS; dnd-kit owns ordered LISTS. This primitive is where that second
// concern lives so later phases reuse it instead of re-hand-rolling drag.
//
// Touch + keyboard accessible out of the box (PointerSensor + KeyboardSensor),
// which the legacy native-HTML5 builders never were.
//
// Usage:
//   <SortableList
//     items={[{id, ...}]}            // each needs a stable string `id`
//     onReorder={(nextItems) => …}   // called with the reordered array
//     renderItem={(item, {dragHandleProps}) => <Row …/>}
//   />
// =============================================================================

import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function SortableRow({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    // The grip is the drag handle; surface its listeners to the child so the
    // whole row doesn't have to be grabbable (lets buttons inside stay
    // clickable). dragHandleProps spreads onto whatever element renders the grip.
  }
  return children({ setNodeRef, style, dragHandleProps: { ...attributes, ...listeners } })
}

export default function SortableList({ items, onReorder, renderItem }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(i => i.id === active.id)
    const newIndex = items.findIndex(i => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(items, oldIndex, newIndex))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
        {items.map(item => (
          <SortableRow key={item.id} id={item.id}>
            {(rowProps) => renderItem(item, rowProps)}
          </SortableRow>
        ))}
      </SortableContext>
    </DndContext>
  )
}
