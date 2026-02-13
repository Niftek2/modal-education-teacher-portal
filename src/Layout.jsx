export default function Layout({ children, currentPageName }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-gradient-to-r from-purple-900 to-purple-800 text-white shadow-lg">
        <div className="flex items-center gap-3 px-6 py-4">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png" 
            alt="Modal Education Logo" 
            className="h-8 w-8 object-contain flex-shrink-0"
          />
          <h1 className="text-2xl font-bold tracking-tight">modal education</h1>
        </div>
      </header>

      {/* Page Content */}
      <main className="flex-grow">
        {children}
      </main>
    </div>
  );
}