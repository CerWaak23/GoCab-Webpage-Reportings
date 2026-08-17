import LoginButton from '@/components/LoginButton';

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-500 mb-4 shadow-lg shadow-green-500/30">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">GoCab</h1>
          <p className="text-gray-500 mt-1 text-sm">Portal de Reportes · Chile</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-1">Ingresar</h2>
          <p className="text-gray-500 text-sm mb-6">
            Ingresa tu correo <span className="text-gray-300 font-medium">@gocab.io</span> y la
            contraseña del portal para acceder.
          </p>

          <LoginButton />
        </div>

        <p className="text-center text-gray-700 text-xs mt-6">
          Acceso restringido · Solo cuentas @gocab.io
        </p>
      </div>
    </main>
  );
}
