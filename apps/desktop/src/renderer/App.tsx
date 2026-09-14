import "./app.css";

export function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">BookEditor</p>
        <h1>Your manuscript workspace</h1>
      </header>
      <section className="welcome-panel" aria-labelledby="welcome-heading">
        <h2 id="welcome-heading">Start writing</h2>
        <p>
          Create or open a project to begin shaping your manuscript. Your work
          stays local and belongs to you.
        </p>
      </section>
    </main>
  );
}
