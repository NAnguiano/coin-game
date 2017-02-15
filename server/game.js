/*
 * Server side game module. Maintains the game state and processes all the messages from clients.
 *
 * Exports:
 *   - addPlayer(name)
 *   - move(direction, name)
 *   - state()
 */

const { clamp, randomPoint, permutation } = require('./gameutil');
const redis = require('redis').createClient();

const WIDTH = 64;
const HEIGHT = 64;
const MAX_PLAYER_NAME_LENGTH = 32;
const NUM_COINS = 100;
const PLAYER_EXPIRE_TIME = 300;


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
// player:<name>    string       "<row>,<col>"
// scores           sorted set   playername with score
// coins            hash         { "<row>,<col>": coinvalue }
// usednames        set          all used names, to check quickly if a name has been used
//
const database = {
  scores: {},
  usednames: new Set(),
  coins: {},
};

exports.addPlayer = (name, io, socket, listener, game) => {
  if (name.length !== 0 || name.length <= MAX_PLAYER_NAME_LENGTH) {
    redis.sismember('usednames', name, (err, res) => {
      if (res === 1) {
        io.to(socket.id).emit('badname', name);
        return false;
      }
      database.usednames.add(name);
      database[`player:${name}`] = randomPoint(WIDTH, HEIGHT).toString();
      database.scores[name] = 0;

      redis.multi()
           .sadd('usednames', name)
           .setex(`player:${name}`, PLAYER_EXPIRE_TIME, randomPoint(WIDTH, HEIGHT).toString())
           .zadd('scores', 0, name)
           .exec((err, res) => {
             console.log(`Created player, added timeout, and added their score with response ${res}`);
             io.to(socket.id).emit('welcome');
             game.state((err, result) => {
               io.emit('state', result);
             });
             socket.removeListener('name', listener);
             socket.on('move', (direction) => {
               game.move(direction, name);
               game.state((err, result) => {
                 io.emit('state', result);
               });
             });
           });
      return true;
    });
  } else {
    io.to(socket.id).emit('badname', name);
  }
};

function placeCoins() {
  redis.del('coins', (err, res) => {
    console.log(`Coins deleted with response ${res}`);
    permutation(WIDTH * HEIGHT).slice(0, NUM_COINS).forEach((position, i) => {
      const coinValue = (i < 50) ? 1 : (i < 75) ? 2 : (i < 95) ? 5 : 10;
      const index = `${Math.floor(position / WIDTH)},${Math.floor(position % WIDTH)}`;
      redis.hset('coins', index, coinValue);
      database.coins[index] = coinValue;
    });
  });
}

// Return only the parts of the database relevant to the client. The client only cares about
// the positions of each player, the scores, and the positions (and values) of each coin.
// Note that we return the scores in sorted order, so the client just has to iteratively
// walk through an array of name-score pairs and render them.
exports.state = (callback) => {
  redis.multi()
       .smembers('usednames')
       .hgetall('coins')
       .zrevrange('scores', 0, -1, 'WITHSCORES')
       .exec((err, res) => {
         const coins = res[1];
         const scores = [];
         while (res[2].length) scores.push(res[2].splice(0, 2));
         console.log(scores);
         const positions = [];
         const len = res[0].length;
         const returnState = () => (
           callback(null, { positions, scores, coins })
         );

         let counter = 0;
         res[0].forEach((name) => {
           const key = `player:${name}`;
           redis.get(key, (err, res) => {
             positions.push([key.substring(7), res]);
             counter += 1;
             if (counter >= len) {
               returnState();
             }
           });
         });
       });
  /*
  const positions = Object.entries(database)
    .filter(([key]) => key.startsWith('player:'))
    .map(([key, value]) => [key.substring(7), value]);
  const scores = Object.entries(database.scores);
  // There's a space because we don't care what the first value is:
  // [['jb', 20], ['kb', 15], ['ll', 20]] -> We only care about numbers not names
  scores.sort(([, v1], [, v2]) => v1 - v2);
  return {
    positions,
    scores,
    coins: database.coins,
  };
  */
};

exports.move = (direction, name) => {
  const delta = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] }[direction];
  if (delta) {
    const playerKey = `player:${name}`;
    const [x, y] = database[playerKey].split(',');
    const [newX, newY] = [clamp(+x + delta[0], 0, WIDTH - 1), clamp(+y + delta[1], 0, HEIGHT - 1)];
    const value = database.coins[`${newX},${newY}`];
    if (value) {
      database.scores[name] += value;
      delete database.coins[`${newX},${newY}`];
    }
    database[playerKey] = `${newX},${newY}`;

    // When all coins collected, generate a new batch.
    if (Object.keys(database.coins).length === 0) {
      placeCoins();
    }
  }
};

exports.killPlayer = (player) => {
  console.log(`He's dead, ${player}`);
};

redis.on('error', (err) => {
  console.error(`Error: ${err}`);
});

placeCoins();
