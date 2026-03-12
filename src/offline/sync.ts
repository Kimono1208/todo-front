/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from "../api";
import {
  getOutbox, clearOutbox, setMapping, getMapping,
  removeTaskLocal, promoteLocalToServer
} from "./db";

let isSyncing = false;

export async function syncNow() {
  if (!navigator.onLine || isSyncing) return;
  isSyncing = true;

  try {
    // Ordenamos por fecha (ts) para que el padre se cree ANTES que el hijo
    const ops = (await getOutbox() as any[]).sort((a, b) => a.ts - b.ts);
    if (!ops.length) return;

    for (const op of ops) {
      // --- OPERACIÓN: CREATE ---
      if (op.op === "create") {
        const payload = { ...op.data };
        
        // Si es una subtarea, verificamos si su parentId ya tiene un ID de servidor
        if (payload.parentId) {
          const mappedId = await getMapping(payload.parentId);
          if (mappedId) payload.parentId = mappedId;
        }

        try {
          const { data } = await api.post("/tasks", payload);
          const serverId = data?.task?._id || data?._id;
          
          if (serverId) {
            await setMapping(op.clienteId, serverId);
            await promoteLocalToServer(op.clienteId, serverId);
          }
        } catch (err) {
          console.error("Error creando tarea en sync:", err);
        }
      }

      // --- OPERACIÓN: UPDATE ---
      else if (op.op === "update") {
        // Buscamos el ID real (si era local, usamos el mapping)
        const realId = op.serverId || (op.clienteId ? await getMapping(op.clienteId) : null);
        if (!realId) continue;

        try {
          await api.put(`/tasks/${realId}`, op.data);
        } catch {}
      }

      // --- OPERACIÓN: DELETE ---
      else if (op.op === "delete") {
        const realId = op.serverId || (op.clienteId ? await getMapping(op.clienteId) : null);
        if (!realId) continue;
        
        try {
          await api.delete(`/tasks/${realId}`);
          await removeTaskLocal(op.clienteId || realId);
        } catch {}
      }
    }

    // Al terminar el bucle, limpiamos el outbox
    await clearOutbox();

  } finally {
    isSyncing = false;
  }
}