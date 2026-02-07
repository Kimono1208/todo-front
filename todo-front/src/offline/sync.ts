import { api } from '../api';
import {
    getOutbox,
    clearOutbox,
    setMapping,
    getMapping,
    removeTaskLocal,
    promoteLocalToServer
} from './db';

let syncing = false;
let lastsync = 0;

export async function syncNow() {
    if(!navigator.onLine) return;//No hay conexión


    //evitar multiples sincronizaciones simultáneas
    const now = Date.now();
    if(now - lastsync < 1500) return;
    lastsync = now;
    if(syncing) return;
    syncing = true;

    try {
        const ops = (await getOutbox()).sort((a, b) => a.ts - b.ts);
        if(!ops.length) return;

        //1 armar lote para bulksync (create + update con clientId)

        const toSync: any[] = [];
        for (const op of ops) {
            if(op.op === "create") {
                toSync.push({
                    clienteId: op.clienteId,
                    title: op.data.title,
                    description: op.data.description ?? "",
                    status: op.data.status ?? "Pendiente",
            });
            }else if (op.op === "update") {
                const cid = op.clienteId;
                if(cid) {
                    toSync.push({
                        clienteId: cid,
                        title: op.data.title,
                        description: op.data.description,
                        status: op.data.status,
                    });
                }else if(op.serverId) {
                    try{
                        await api.put(`/tasks/${op.serverId}`, op.data);
                    }catch{
                        return;
                    }
                }
            }
        }
        // 2 ejecutar bulksync y subir ids al servidor
        if(toSync.length) {
            try{
                const {data} = await api.post("/tasks/bulksync", {tasks: toSync}); 
                for( const map of data?.mappings || []) {
                    await setMapping(map.clienteId, map.serverId);
                    await promoteLocalToServer(map.clienteId, map.serverId);
                }
            }catch{
                //si falla el bulksync, no continuar
                return;
            }
    }

    //3 procesar deletes
    for (const op of ops) {
        if(op.op !== "delete") continue;
        const serverId = 
        op.serverId ?? (op.clienteId ? await getMapping(op.clienteId) : undefined);
        if(!serverId) continue; 
        try{
            await api.delete(`/tasks/${serverId}`);
            await removeTaskLocal(op.clienteId || serverId);
        }catch{
            //si falla un delete, continuar con el siguiente
        }
    }//si todo lo anterior fue bien, limpiar outbox
    await clearOutbox();
    } finally {
        syncing = false;
    }
}


export function setupOnlineSync() {
    const handler = () => {
        void syncNow();
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
}
