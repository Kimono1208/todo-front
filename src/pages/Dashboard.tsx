/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { api, setAuth } from "../api";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
} from "../offline/db";
import { syncNow } from "../offline/sync";

type Status = "Pendiente" | "En Progreso" | "Completada";

type Task = {
  _id: string;                 // serverId o clienteId (offline)
  title: string;
  description?: string;
  status: Status;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;
  subtasks?: Task[];
  parentId?: string;
};

// id local (no 24 hex de Mongo)
const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);

// Normaliza lo que venga del backend
function normalizeTask(x: any): Task {
  return {
    _id: String(x?._id ?? x?.id),
    title: String(x?.title ?? "(sin título)"),
    description: x?.description ?? "",
    status:
      x?.status === "Completada" ||
        x?.status === "En Progreso" ||
        x?.status === "Pendiente"
        ? x.status
        : "Pendiente",
    clienteId: x?.clienteId,
    createdAt: x?.createdAt,
    deleted: !!x?.deleted,
    pending: !!x?.pending,
    parentId: x?.parentId,
  };
}

interface TaskItemProps {
  task: Task;
  allTasks: Task[];
  onStatusChange: (task: Task, newStatus: Status) => void;
  onAddSubtask: (parent: Task) => void;
  onEdit: (task: Task) => void;
  onRemove: (id: string) => void;
  onSaveEdit: (id: string) => void;
  isEditing: boolean;
  editState: { id: string | null; title: string; description: string };
  setEditState: (state: any) => void;
}

function TaskItem({ 
  task, 
  allTasks, 
  onStatusChange, 
  onAddSubtask, 
  onEdit, 
  onRemove, 
  isEditing, 
  editState, 
  setEditState, 
  onSaveEdit 
}: TaskItemProps) { // <--- Cambiamos 'any' por 'TaskItemProps'
  
  const subtasks = allTasks.filter((t) => t.parentId === task._id);

  return (
  <li className={task.status === "Completada" ? "item done" : "item"}>
    {/* Esta es la fila que usa el GRID de 3 columnas */}
    <div className="item-main-row">
      <select
        value={task.status}
        onChange={(e) => onStatusChange(task, e.target.value as Status)}
        className="status-select"
      >
        <option value="Pendiente">Pendiente</option>
        <option value="En Progreso">En Progreso</option>
        <option value="Completada">Completada</option>
      </select>

      <div className="content">
        {isEditing ? (
          <input
            className="edit"
            value={editState.title}
            onChange={e => setEditState({ ...editState, title: e.target.value })}
            autoFocus
          />
        ) : (
          <span className="title" onDoubleClick={() => onEdit(task)}>{task.title}</span>
        )}
      </div>

      <div className="actions">
        {isEditing ? (
          <button className="btn" onClick={() => onSaveEdit(task._id)}>S</button>
        ) : (
          <>
            <button className="icon" onClick={() => onAddSubtask(task)}>➕</button>
            <button className="icon" onClick={() => onEdit(task)}>✏️</button>
            <button className="icon danger" onClick={() => onRemove(task._id)}>🗑️</button>
          </>
        )}
      </div>
    </div>

    {/* Las subtareas quedan fuera del Grid principal, por eso ya no se aplastan */}
    {subtasks.length > 0 && (
      <ul className="sub-list">
        {subtasks.map((sub: any) => (
          <TaskItem
            key={sub._id}
            task={sub}
            allTasks={allTasks}
            onStatusChange={onStatusChange}
            onAddSubtask={onAddSubtask}
            onEdit={onEdit}
            onRemove={onRemove}
            onSaveEdit={onSaveEdit}
            isEditing={editState.id === sub._id}
            editState={editState}
            setEditState={setEditState}
          />
        ))}
      </ul>
    )}
  </li>
);
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    // Suscripción que dispara sync al volver online (definida en offline/sync)
    // const unsubscribe = setupOnlineSync();

    // Handlers de estado (sin recargar)
    const on = async () => {
      setOnline(true);
      await syncNow();
      await loadFromServer();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    (async () => {
      // 1) Mostrar cache local primero
      const local = await getAllTasksLocal();
      if (local?.length) setTasks(local.map(normalizeTask));

      // 2) Intentar traer del server
      await loadFromServer();

      // 3) Intentar sincronizar pendientes
      await syncNow();

      // 4) Re-cargar del server por si hubo mapeos nuevos
      await loadFromServer();
    })();

    return () => {
      //unsubscribe?.();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function loadFromServer() {
    try {
      const { data } = await api.get("/tasks"); // { items: [...] }
      const raw = Array.isArray(data?.items) ? data.items : [];
      const list = raw.map(normalizeTask);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // si falla, nos quedamos con lo local
    } finally {
      setLoading(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const d = description.trim();
    if (!t) return;


    // Crear local inmediatamente
    const clienteId = crypto.randomUUID();
    const localTask = normalizeTask({
      _id: clienteId,
      title: t,
      description: d,
      status: "Pendiente" as Status,
      pending: !navigator.onLine, // <- marca “Falta sincronizar” si no hay red
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);
    setTitle("");
    setDescription("");

    if (!navigator.onLine) {
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
      return;
    }

    // Online directo
    try {
      const { data } = await api.post("/tasks", { title: t, description: d });
      const created = normalizeTask(data?.task ?? data);
      setTasks((prev) => prev.map((x) => (x._id === clienteId ? created : x)));
      await removeTaskLocal(clienteId);
      await putTaskLocal(created);
    } catch {
      // si falla, encola
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
    }
  }

  async function addSubtask(parent: Task) {
    const subTitle = prompt(`Nueva subtarea para: ${parent.title}`);

    // 1. Validar que el usuario escribió algo
    if (!subTitle || !subTitle.trim()) return;

    const titleValue = subTitle.trim();
    const clienteId = crypto.randomUUID();

    // 2. Crear el objeto con las variables correctas
    const localTask = normalizeTask({
      _id: clienteId,
      title: titleValue, // Antes tenías 't', por eso fallaba
      description: "",   // Antes tenías 'd'
      status: "Pendiente" as Status,
      parentId: parent._id, // Enlazamos al ID del padre
      pending: !navigator.onLine,
    });

    // 3. Actualizar estado y DB Local
    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);

    // 4. Lógica de Sincronización (Outbox u Online)
    if (!navigator.onLine) {
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
      return;
    }

    try {
      // Enviamos el objeto al server incluyendo el parentId
      const { data } = await api.post("/tasks", localTask);
      const created = normalizeTask(data?.task ?? data);

      setTasks((prev) => prev.map((x) => (x._id === clienteId ? created : x)));
      await removeTaskLocal(clienteId);
      await putTaskLocal(created);
    } catch {
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
    }
  }

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    const newDesc = editingDescription.trim();
    if (!newTitle) return;

    const before = tasks.find((t) => t._id === taskId);
    const patched = { ...before, title: newTitle, description: newDesc } as Task;

    setTasks((prev) => prev.map((t) => (t._id === taskId ? patched : t)));
    await putTaskLocal(patched);
    setEditingId(null);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        clienteId: isLocalId(taskId) ? taskId : undefined,
        serverId: isLocalId(taskId) ? undefined : taskId,
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
      return;
    }

    try {
      await api.put(`/tasks/${taskId}`, { title: newTitle, description: newDesc });
    } catch {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        serverId: taskId,
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
    }
  }

  async function handleStatusChange(task: Task, newStatus: Status) {
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId: isLocalId(task._id) ? undefined : task._id,
        clienteId: isLocalId(task._id) ? task._id : undefined,
        data: { status: newStatus },
        ts: Date.now(),
      });
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
    } catch {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId: task._id,
        data: { status: newStatus },
        ts: Date.now(),
      });
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((t) => t._id !== taskId && t.parentId !== taskId));
    await removeTaskLocal(taskId);

    if (!navigator.onLine) {
      await queue({ id: "del-" + taskId, op: "delete", serverId: isLocalId(taskId) ? undefined : taskId, clienteId: isLocalId(taskId) ? taskId : undefined, ts: Date.now() });
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      // rollback + encola
      setTasks(backup);
      for (const t of backup) await putTaskLocal(t);
      await queue({ id: "del-" + taskId, op: "delete", serverId: taskId, clienteId: isLocalId(taskId) ? taskId : undefined, ts: Date.now() });
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    window.location.href = "/"; // login
  }

const filtered = useMemo(() => {
  let list = tasks;

 
  if (search.trim()) {
    const s = search.toLowerCase();
    list = list.filter(
      (t) =>
        (t.title || "").toLowerCase().includes(s) ||
        (t.description || "").toLowerCase().includes(s)
    );
  }

  if (filter === "active") list = list.filter((t) => t.status !== "Completada");
  if (filter === "completed") list = list.filter((t) => t.status === "Completada");

  return list.filter(t => !t.parentId); 
}, [tasks, search, filter]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Completada").length;
    const percentage = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, pending: total - done, percentage };
  }, [tasks]);

  return (
    <div className="wrap">
      <header className="topbar">
        <h1>To-Do PWA</h1>
        <div className="spacer" />
        <div className="stats">
          <span>Total: {stats.total}</span>
          <span>Hechas: {stats.done}</span>
          <span>Pendientes: {stats.pending}</span>
          <span className="badge" style={{ marginLeft: 8, background: online ? "#1f6feb" : "#b45309" }}>
            {online ? "Online" : "Offline"}
          </span>
        </div>
        <button className="btn danger" onClick={logout}>Salir</button>
      </header>

      <main>
        {/* ===== Barra de Progreso ===== */}
        <div className="progress-container" style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '0.9rem' }}>
            <span>Progreso total</span>
            <span>{stats.percentage}%</span>
          </div>
          <div style={{
            width: '100%',
            backgroundColor: '#30363d', // Color de fondo de la barra (oscuro)
            borderRadius: '8px',
            height: '10px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${stats.percentage}%`,
              backgroundColor: stats.percentage === 100 ? '#238636' : '#1f6feb', // Verde si terminó, azul si no
              height: '100%',
              transition: 'width 0.4s ease-in-out' // Animación suave
            }} />
          </div>
        </div>
        {/* ===== Crear ===== */}
        <form className="add add-grid" onSubmit={addTask}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título de la tarea…"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (opcional)…"
            rows={2}
          />
          <button className="btn">Agregar</button>
        </form>

        {/* ===== Toolbar ===== */}
        <div className="toolbar">
          <input
            className="search"
            placeholder="Buscar por título o descripción…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="filters">
            <button
              className={filter === "all" ? "chip active" : "chip"}
              onClick={() => setFilter("all")}
              type="button"
            >
              Todas
            </button>
            <button
              className={filter === "active" ? "chip active" : "chip"}
              onClick={() => setFilter("active")}
              type="button"
            >
              Activas
            </button>
            <button
              className={filter === "completed" ? "chip active" : "chip"}
              onClick={() => setFilter("completed")}
              type="button"
            >
              Hechas
            </button>
          </div>
        </div>

        {/* ===== Lista ===== */}
        {loading ? (
          <p>Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas</p>
        ) : (
          <ul className="list">
            {filtered.map((t) => (
              <TaskItem
                key={t._id}
                task={t}
                allTasks={tasks} // Ojo: pasamos 'tasks' (todas), no 'filtered'
                onStatusChange={handleStatusChange}
                onAddSubtask={addSubtask}
                onEdit={startEdit}
                onRemove={removeTask}
                onSaveEdit={saveEdit}
                isEditing={editingId === t._id}
                editState={{ id: editingId, title: editingTitle, description: editingDescription }}
                setEditState={(s: any) => {
                  setEditingTitle(s.title);
                  setEditingDescription(s.description);
                }}
              />
            ))}
          </ul>
        )}

      </main>
    </div>
  );
}