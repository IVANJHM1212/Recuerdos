# 📸 Recuerdos Familiares

Una aplicación web sencilla y elegante para **guardar y compartir fotos y videos familiares**, accesible mediante un enlace o código QR con token de acceso seguro.  
Construida con **Node.js (Express)**, **SQLite**, y un frontend HTML/CSS puro, permite a un administrador subir recuerdos y a los usuarios visualizarlos sin necesidad de registro.

---

## 🚀 Características principales

### 👨‍👩‍👧 Galería de recuerdos
- Visualiza fotos y videos con un diseño limpio y responsivo.  
- Al hacer clic en un recuerdo, se abre un **modal (lightbox)** mostrando:
  - Imagen o video.
  - **Título, fecha y descripción.**

### 🔐 Acceso seguro mediante token
- Cada enlace de acceso se genera con un token firmado.
- Solo las personas con el enlace pueden ver la galería.

### 🧑‍💼 Panel de administración
- Permite subir imágenes y videos desde `admin.html`.
- Soporta campos:
  - Archivo (imagen o video)
  - Título del recuerdo
  - Fecha del evento
  - Descripción (opcional)
- Requiere autenticación básica (usuario y contraseña definidos en variables de entorno).

### 💾 Almacenamiento local
- Los archivos y la base de datos (`db.sqlite`) se guardan en la carpeta `data/`.
- Se puede usar un disco persistente al desplegar (ej. Render o Railway).

---

## 🛠️ Tecnologías utilizadas

| Componente | Tecnología |
|-------------|-------------|
| Backend | Node.js + Express |
| Base de datos | SQLite (better-sqlite3) |
| Subida de archivos | Multer |
| Autenticación | Basic Auth + Tokens HMAC |
| Frontend | HTML, CSS, JS puro |
| Hosting recomendado | Render / Railway |

---

## ⚙️ Instalación local

### 1️⃣ Clonar el repositorio
```bash
git clone https://github.com/tu-usuario/recuerdos-familiares.git
cd recuerdos-familiares
2️⃣ Instalar dependencias
bash
Copiar código
npm install
3️⃣ Crear estructura de carpetas
bash
Copiar código
mkdir data
mkdir data/uploads
4️⃣ Variables de entorno (opcional)
Crea un archivo .env (no se sube al repo) con:

ini
Copiar código
SECRET=clave_super_secreta
ADMIN_USER=admin
ADMIN_PASS=1234
DATA_DIR=./data
5️⃣ Ejecutar el servidor
bash
Copiar código
npm start
Por defecto escuchará en http://localhost:3000

🧭 Uso
📷 Subir un recuerdo
Abre http://localhost:3000/admin.html

Ingresa usuario y contraseña admin.

Completa los campos y sube tu imagen/video.

🪪 Crear enlace de acceso
Abre en tu navegador:

bash
Copiar código
http://localhost:3000/create-token
Obtendrás algo como:

json
Copiar código
{
  "token": "eyJmb3IiOiJyZWN1ZXJkbyIsImV4cCI6MTcwNjE5NjM0OX0.X5h0pC0...",
  "url": "http://localhost:3000/access/eyJmb3IiOiJyZWN1ZXJk..."
}
Comparte la URL generada con tu familia para que puedan ver la galería.

☁️ Despliegue en Render
Crea una cuenta en https://render.com

Sube este repositorio a GitHub.

En Render → New Web Service → conecta el repo.

Configura:

Build Command: npm install

Start Command: node server.js

Variables de entorno:

ini
Copiar código
SECRET=clave_larga_y_segura
ADMIN_USER=admin
ADMIN_PASS=1234
DATA_DIR=/opt/render/project/src/data
En la pestaña Disks, crea un disco persistente:

Mount Path: /opt/render/project/src/data

Tamaño: 1 GB o más.

¡Deploy! 🎉
Render te dará un enlace como https://recuerdos.onrender.com

🧰 Estructura del proyecto
pgsql
Copiar código
📂 recuerdos-familiares
 ├── 📁 public
 │   ├── index.html        → Página principal (galería)
 │   └── admin.html        → Panel de administración
 ├── 📁 data               → Archivos subidos y base de datos (ignorado en git)
 ├── server.js             → Servidor Express principal
 ├── package.json          → Dependencias y scripts
 ├── .gitignore
 └── README.md
🔒 Seguridad
El acceso público requiere un token generado por /create-token.

Las subidas están protegidas con autenticación básica.

Los archivos se almacenan en el servidor, no se exponen rutas directas.

📬 Licencia
Este proyecto es de uso personal y educativo.
Puedes modificarlo libremente para tus propios recuerdos familiares. 💕

✨ Autor
Iván Hernández Morales
👨‍💻 Ingeniero en Informática — Desarrollador Full Stack
📍 Chile
💬 "Preserva los recuerdos más valiosos de tu familia con tecnología."

yaml
Copiar código
