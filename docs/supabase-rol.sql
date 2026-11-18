-- Rol con permisos mínimos para el servidor de la landing.
-- Ejecútalo en Supabase > SQL Editor. Cambia la clave antes de correrlo.
-- El servidor solo necesita leer, insertar y actualizar la tabla "Customer".

create role izzy_landing login password 'CAMBIA_ESTA_CLAVE_LARGA';
grant usage on schema public to izzy_landing;
grant select, insert, update on table public."Customer" to izzy_landing;

-- Con el pooler de Supabase el usuario de la cadena de conexión es:  izzy_landing.<ID_DEL_PROYECTO>
-- Para revocar el acceso en cualquier momento:  drop owned by izzy_landing; drop role izzy_landing;
