import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/game.css";
import "./styles/hud.css";
import "./styles/object-actions.css";
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="loading-screen">
        <div className="loading-card">
          <h1>Something interrupted the game.</h1>
          <p>{this.state.error.message}</p>
          <button onClick={() => location.reload()}>Reload your empire</button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
