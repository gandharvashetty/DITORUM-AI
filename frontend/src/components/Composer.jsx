import "../styles/composer.css";

function Composer() {
  return (
    <div className="composer">
      <button className="plus">+</button>

      <input
        type="text"
        placeholder="Message DITORUM AI..."
      />

      <button className="send">Send</button>
    </div>
  );
}

export default Composer;