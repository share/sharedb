var React = require('react');
var classNames = require('classnames');

var Player = React.createClass({
  propTypes: {
    playerId: React.PropTypes.string.isRequired,
    onPlayerSelected: React.PropTypes.func.isRequired,
    selected: React.PropTypes.bool.isRequired
  },

  getInitialState() {
    return {player: {}};
  },

  handleClick: function(event) {
    this.props.onPlayerSelected(this.props.playerId);
  },

  componentDidMount: function() {
    var comp = this;
    var doc = comp.doc = connection.get('players', comp.props.playerId);

    doc.subscribe(update);
    doc.on('load', update);
    doc.on('op', update);
    function update() {
      comp.setState({player: doc.data});
    }
  },

  componentWillUnmount: function() {
    this.doc.unsubscribe();
  },

  render: function() {
    var classes = {
      'player': true,
      'selected': this.props.selected
    };

    return (
      <li className={classNames(classes)} onClick={this.handleClick}>
        <span className="name">{this.state.player.name}</span>
        <span className="score">{this.state.player.score}</span>
      </li>
    );
  }
});

module.exports = Player;
