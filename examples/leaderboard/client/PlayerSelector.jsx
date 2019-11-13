var PropTypes = require('prop-types');
var React = require('react');

function PlayerSelector({ selectedPlayer, onAddPoints }) {
  var node;

  if (selectedPlayer) {
    node = <div className="details">
      <div className="name">{selectedPlayer.data.name}</div>
      <button className="inc" onClick={onAddPoints}>Add 5 points</button>
    </div>;
  } else {
    node = <div className="message">Click a player to select</div>;
  }

  return node;
}

PlayerSelector.propTypes = {
  selectedPlayer: PropTypes.object
};

module.exports = PlayerSelector;
