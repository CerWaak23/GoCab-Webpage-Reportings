/**
 * GoCab user database.
 *
 * Para agregar o editar usuarios, actualiza el arreglo USERS.
 * El campo "email" debe coincidir exactamente con la cuenta Google @gocab.io.
 *
 * Roles con acceso al Reporte Financiero: cualquier rol que contenga "Gerente".
 */

const USERS = [
  { name: 'Joy Varela',      email: 'joy.varela@gocab.io',      role: 'Coordinador de Flota'    },
  { name: 'Artem Tokarev',   email: 'artem.tokarev@gocab.io',   role: 'Gerente de Producto'     },
  { name: 'Andrés Cerda',    email: 'andres.cerda@gocab.io',    role: 'Gerente de Operaciones'  },
  { name: 'Felipe Catalan',  email: 'felipe.catalan@gocab.io',  role: 'Gerente de Pais'         },
];

/**
 * Cualquier rol que contenga "gerente" (case-insensitive) tiene acceso al reporte financiero.
 */
export function isManager(role) {
  if (!role) return false;
  return role.toLowerCase().includes('gerente');
}

/**
 * Devuelve true solo si el email está explícitamente registrado en la lista maestra.
 * Un @gocab.io no registrado NO tiene acceso.
 */
export function isRegisteredUser(email) {
  if (!email) return false;
  return USERS.some(u => u.email.toLowerCase() === email.toLowerCase());
}

export function getUserByEmail(email) {
  if (!email) return null;

  const found = USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (found) {
    return { ...found, isManager: isManager(found.role) };
  }

  // Usuario @gocab.io no registrado: acceso básico
  if (email.endsWith('@gocab.io')) {
    return {
      name: email.split('@')[0],
      email,
      role: 'Colaborador',
      isManager: false,
    };
  }

  return null;
}
