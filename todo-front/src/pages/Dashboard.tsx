import { useEffect, useMemo, useState } from "react";
import { api, setAuth } from "../api";

type Task = {
  _id: string;
  title: string;
  completed: boolean;
  createdAt?: string;
};

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    setAuth(localStorage.getItem("token"));
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);
    try {
      const { data } = await api.get("/tasks");
      // Acepta varias formas: [], {tasks: []}, {data: []}
      console.log("GET /tasks →", data);
      const list: Task[] =
        Array.isArray(data) ? data :
        Array.isArray(data?.tasks) ? data.tasks :
        Array.isArray(data?.data) ? data.data : [];
      setTasks(list);
    } finally {
      setLoading(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const { data } = await api.post("/tasks", { title: t });
    setTasks((prev) => [data, ...prev]);
    setTitle("");
  }

  async function toggleTask(task: Task) {
    const updated = { ...task, completed: !task.completed };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    try {
      await api.patch(`/tasks/${task._id}`, { completed: updated.completed });
    } catch {
      // rollback
      setTasks((prev) => prev.map((x) => (x._id === task._id ? task : x)));
    }
  }

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    if (!newTitle) return;
    const old = tasks.find((t) => t._id === taskId);
    setTasks((prev) => prev.map((t) => (t._id === taskId ? { ...t, title: newTitle } : t)));
    setEditingId(null);
    try {
      await api.put(`/tasks/${taskId}`, { title: newTitle });
    } catch {
      if (old) setTasks((prev) => prev.map((t) => (t._id === taskId ? old : t)));
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      setTasks(backup); // rollback
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    window.location.href = "/"; // te lleva al login (ruta "/")
  }

  // Seguridad extra por si tasks no es array
  const safeTasks = Array.isArray(tasks) ? tasks : [];

  const filtered = useMemo(() => {
    let list = safeTasks;
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((t) => (t.title || "").toLowerCase().includes(s));
    }
    if (filter === "active") list = list.filter((t) => !t.completed);
    if (filter === "completed") list = list.filter((t) => t.completed);
    return list;
  }, [safeTasks, search, filter]);

  const stats = useMemo(() => {
    const total = safeTasks.length;
    const done = safeTasks.filter((t) => t.completed).length;
    return { total, done, pending: total - done };
  }, [safeTasks]);

  return (
    <div className="wrap">
      <header className="topbar">
        <h1>To-Do PWA</h1>
        <div className="spacer" />
        <div className="stats">
          <span>Total: {stats.total}</span>
          <span>Hechas: {stats.done}</span>
          <span>Pendientes: {stats.pending}</span>
        </div>
        <button className="btn danger" onClick={logout}>Salir</button>
      </header>

      <main>
        <form className="add" onSubmit={addTask}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nueva tarea…"
          />
          <button className="btn">Agregar</button>
        </form>

        <div className="toolbar">
          <input
            className="search"
            placeholder="Buscar…"
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

        {loading ? (
          <p>Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas</p>
        ) : (
          <ul className="list">
            {filtered.map((t) => (
              <li key={t._id} className={t.completed ? "item done" : "item"}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={t.completed}
                    onChange={() => toggleTask(t)}
                  />
                </label>

                {editingId === t._id ? (
                  <input
                    className="edit"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(t._id)}
                    onBlur={() => saveEdit(t._id)}
                    autoFocus
                  />
                ) : (
                  <span className="title" onDoubleClick={() => startEdit(t)}>
                    {t.title}
                  </span>
                )}

                <div className="actions">
                  {editingId !== t._id && (
                    <button className="icon" title="Editar" onClick={() => startEdit(t)}>
                      ✏️
                    </button>
                  )}
                  <button className="icon danger" title="Eliminar" onClick={() => removeTask(t._id)}>
                    🗑️
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}