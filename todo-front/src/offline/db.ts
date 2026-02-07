import { openDB } from "idb";

type DBSchema = {
    tasks: {key: string; value: any};
    outbox: {key: string; value: any};
    meta: {key: string; value: any};
};

let dbp: ReturnType<typeof openDB<DBSchema>>;
export function db() {
    if (!dbp) {
        dbp = openDB<DBSchema>("todo-db", 1, {
            upgrade(db) {
                db.createObjectStore("tasks", { keyPath: "id" });
                db.createObjectStore("outbox", { autoIncrement: true });
                db.createObjectStore("meta");
            }
        });
    }
    return dbp;
}

export async function cacheTask(list: any[]) {
    const tx = (await db()).transaction("tasks", "readwrite");
    const s = tx.objectStore("tasks");
    await s.clear();
    await s.clear();
    for (const t of list)
        await s.put(t);
    await tx.done;
}

export async function putTaskLocal(task: any) { await ((await db()).
put("tasks", task)); }
export async function getTaskLocal(){
    return (await (await db()).getAll("tasks")) || [];
    
}
 export async function removeTaskLocal(id: string){await ((await db()).
 delete("tasks", id)); }

 //ClienteID para que el server pueda identidicar el cliente

    export async function promoteLocalToServer(clienteId: string, serverId: string ) {
        const d = await db();
        const t = await d.get("tasks", clienteId);
        if (t) {
            await d.delete("tasks", clienteId);
            t.id = serverId;
            t.pendenting = false;
            await d.put("tasks", t);
        }
    }

    //Outbox para sincronizacion

    export type OutboxOp= 
    |{id:string; op:"create"; clienteId:string; data:any; ts:number}
    |{id:string; op:"update"; serverId?:string; data:any; ts:number}
    |{id:string; op:"delete"; serverId?:string; ts:number};

    export async function queue(op: OutboxOp) {await ((await db()).add("outbox", op)); }
    export async function getOutbox() { return (await (await db()).getAll("outbox")) || []; }
    export async function clearOutbox(){const tx = (await db()).transaction("outbox", "readwrite");
    await tx.store.clear(); await tx.done;  
    } 

    //Mapeo clienteID <-> serverID

    export async function setMapping(clienteId: string, serverId: string) {
        await (await db()).put("meta",{key:clienteId, value:serverId   });
    }
export async function getMapping(clienteId: string) {return (await (await db()).get
    ("meta", clienteId))?.value as string|undefined; }
