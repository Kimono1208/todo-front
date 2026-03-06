import axios from "axios";
export const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || "http://localhost:4000",

});

export function setAuth(token: string | null){
    if (token) api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    else delete api.defaults.headers.common["Authorization"];
}

setAuth(localStorage.getItem("token"));

// si el token expira o es invalido eliminar el token y redirigir al login

// En tu archivo api.ts
api.interceptors.response.use(
    (r) => r,
    (err) => {
        // 1. Verificamos si es un error de autorización
        const isAuthError = err.response?.status === 401;
        // 2. Verificamos si la ruta que falló NO es la de sincronización
        const isNotSync = !err.config.url?.includes("bulksync");

        if (isAuthError && isNotSync) {
            console.log(err.response);
            localStorage.removeItem("token");
            setAuth(null);
            window.location.href = "/login";
        }
        return Promise.reject(err);
    }
);