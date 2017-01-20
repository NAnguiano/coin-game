/*
 * Server side game module. Maintains the game state and processes all the messages from clients.
 *
 * Exports:
 *   - move
 *   - state
 *   - addPlayer
 */

const {clamp, randomPoint, permutationArray} = require('./gameutil')

const WIDTH = 64;
const HEIGHT = 64;


// A KEY-VALUE "DATABASE" FOR THE GAME STATE.
//
// The game state is maintained in an object. Your homework assignment is to swap this out
// for a Redis database.
//
// In this version, the players never die. For homework, you need to make a player die after
// five minutes of inactivity. You can use the Redis TTL for this.
//
// Here is how the storage is laid out:
//
// player:<name>    "<row>,<col>"
// scores           sorted set with score and playername
// coins            hash { "<row>,<col>": coinvalue }
// usednames        set of all used names, used to check quickly if a name has been used
//
const database = {
  scores: {},
  usednames: new Set(),
  coins: {},
};

exports.addPlayer = (name) => {
  if (database.usednames.has(name)) {
    return false;
  }
  database.usednames.add(name);
  database[`player:${name}`] = randomPoint(WIDTH, HEIGHT).toString();
  database.scores[name] = 0;
  return true;
};

function placeCoins() {
  permutationArray(WIDTH * HEIGHT).slice(0, 100).forEach((position, i) => {
    const coinValue = i < 50 ? 1 : i < 75 ? 2 : i < 95 ? 5 : 10;
    const index = `${Math.floor(position / WIDTH)},${Math.floor(position % WIDTH)}`
    database.coins[index] = coinValue;
  })
}

// Return only the parts of the database relevant to the client. The client only cares about
// the positions of each player, the scores, and the positions (and values) of each coin.
// Note that we return the scores in sorted order, so the client just has to iteratively
// walk through an array of name-score pairs and render them.
exports.state = () => {
  const positions = Object.entries(database)
    .filter(([key, _]) => key.startsWith('player:'))
    .map(([key, value]) => [key.substring(7), value]);
  let scores = Object.entries(database.scores);
  scores.sort(([k1, v1], [k2, v2]) => v1 < v2)
  return {
    positions,
    scores,
    coins: database.coins,
  };
};

exports.move = (direction) => {
  const delta = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] }[direction];
  if (delta) {
    // TODO: This has to be an actual player.
    const key = 'player:alice';
    const [x, y] = database[key].split(',');
    const [newX, newY] = [clamp(+x + delta[0], 0, WIDTH - 1), clamp(+y + delta[1], 0, HEIGHT - 1)];
    const value = database.coins[`${newX},${newY}`];
    if (value) {
      database.scores[key.substring(7)] += value;
      delete database.coins[`${newX},${newY}`];
    }
    database[key] = `${newX},${newY}`;

    // When all coins collected, generate a new batch.
    if (Object.keys(database.coins).length == 0) {
      placeCoins();
    }
  }
};

placeCoins();
exports.addPlayer('alice');
exports.addPlayer('bob');