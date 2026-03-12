import { openDB } from "idb";

type DBSchema = {
  tasks:  { key: string; value: any };
  outbox: { key: string; value: any };
  meta:   { key: string; value: any };
};

let dbp: ReturnType<typeof openDB<DBSchema>>;
export function db() {
  if (!dbp) {
    dbp = openDB<DBSchema>("todo-pwa", 1, {
      upgrade(d) {
        d.createObjectStore("tasks", { keyPath: "_id" });
        d.createObjectStore("outbox", { keyPath: "id" });
        d.createObjectStore("meta", { keyPath: "key" });
      },
    });
  }
  return dbp;
}

export async function cacheTasks(list:any[]) {
  const tx = (await db()).transaction("tasks", "readwrite");
  const s = tx.objectStore("tasks");
  await s.clear();
  for (const t of list) await s.put(t);
  await tx.done;
}
export async function putTaskLocal(task:any){ await (await db()).put("tasks", task); }
export async function getAllTasksLocal(){ return (await (await db()).getAll("tasks")) || []; }
export async function removeTaskLocal(id:string){ await (await db()).delete("tasks", id); }

export async function promoteLocalToServer(clienteId: string, serverId: string) {
  const d = await db();
  const t = await d.get("tasks", clienteId);
  if (t) {
    await d.delete("tasks", clienteId);
    t._id = serverId;
    t.pending = false;
    // Si la tarea es una subtarea y su padre ya cambió a serverId, lo actualizamos aquí también
    const mappedParent = await getMapping(t.parentId);
    if (mappedParent) t.parentId = mappedParent;

    await d.put("tasks", t);
    
    // 🔥 CLAVE: Si esta tarea tiene hijos, actualizamos el parentId de esos hijos
    await updateChildrenParentId(clienteId, serverId);
  }
}


/** * Actualiza las subtareas en IndexedDB que apuntan a un ID temporal
 */
async function updateChildrenParentId(oldId: string, newId: string) {
  const d = await db();
  const all = await d.getAll("tasks");
  for (const t of all) {
    if (t.parentId === oldId) {
      t.parentId = newId;
      await d.put("tasks", t);
    }
  }
}




// OUTBOX
export type OutboxOp =
  | { id:string; op:"create"; clienteId:string; data:any; ts:number }
  | { id:string; op:"update"; serverId?:string; clienteId?:string; data:any; ts:number }
  | { id:string; op:"delete"; serverId?:string; clienteId?:string; ts:number };

export async function queue(op:OutboxOp){ await (await db()).put("outbox", op); }
export async function getOutbox(){ return (await (await db()).getAll("outbox")) || []; }
export async function clearOutbox(){ const tx=(await db()).transaction("outbox","readwrite"); await tx.store.clear(); await tx.done; }

// Mapeo clienteId->serverId
export async function setMapping(clienteId:string, serverId:string){ await (await db()).put("meta", { key: clienteId, serverId }); }
export async function getMapping(clienteId:string){ return (await (await db()).get("meta", clienteId))?.serverId as string|undefined; }