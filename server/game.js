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
// const PLAYER_EXPIRE_TIME = 300;


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

exports.addPlayer = (name, io, socket, listener, game, callback) => {
  if (name.length !== 0 || name.length <= MAX_PLAYER_NAME_LENGTH) {
    redis.sismember('usednames', name, (err, res) => {
      if (res === 1) {
        io.to(socket.id).emit('badname', name);
        return false;
      }

      redis.multi()
           .sadd('usednames', name)
           .set(`player:${name}`, randomPoint(WIDTH, HEIGHT).toString())
           .zadd('scores', 0, name)
           .exec((err) => {
             if (err) console.error('PROBLEMS!');
             callback(null);
           });
      return true;
    });
  } else {
    io.to(socket.id).emit('badname', name);
  }
};

function placeCoins(callback) {
  redis.del('coins', (err) => {
    if (err) console.error('Coins not deleted.');
    const permutations = permutation(WIDTH * HEIGHT).slice(0, NUM_COINS);
    permutations.forEach((position, i) => {
      const coinValue = (i < 50) ? 1 : (i < 75) ? 2 : (i < 95) ? 5 : 10;
      const index = `${Math.floor(position / WIDTH)},${Math.floor(position % WIDTH)}`;
      redis.hset('coins', index, coinValue, (err) => {
        if (err) console.err('I really don\'t know how you managed to get here.');
        if (i === permutations.length - 1) callback(null);
      });
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
         const positions = [];
         const addToPositions = (name, cb) => {
           const key = `player:${name}`;
           redis.get(key, (err, res) => {
             positions.push([key.substring(7), res]);
             cb();
           });
         };
         const requests = res[0].map((name) => {
           console.log(`Processing ${name}`);
           return new Promise((resolve) => {
             addToPositions(name, resolve);
           });
         });
         Promise.all(requests).then(() => {
           callback(null, { positions, scores, coins });
         });
       });
};

exports.move = (direction, name, game, io, callback) => {
  const delta = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] }[direction];
  if (delta) {
    const playerKey = `player:${name}`;
    redis.get(playerKey, (err, res) => {
      const [x, y] = res.split(',');
      const [newX, newY] = [clamp(+x + delta[0], 0, WIDTH - 1),
        clamp(+y + delta[1], 0, HEIGHT - 1)];
      redis.hget('coins', `${newX},${newY}`, (err, value) => {
        if (value) {
          redis.multi()
               .zincrby('scores', value, name)
               .hdel('coins', `${newX},${newY}`)
               .hlen('coins')
               .exec((err, res) => {
                 if (err) console.error('Problems!');
                 if (res[2] === 0) {
                   placeCoins((err) => {
                     if (err) console.error('Coins could not be placed.');
                     game.state((err, result) => {
                       // console.log(result);
                       io.emit('state', result);
                     });
                   });
                 }
               });
        }
        redis.set(playerKey, `${newX},${newY}`, (err) => {
          if (err) console.error('???');
          callback(null, 0);
        });
      });
    });
  }
};

exports.killPlayer = (player) => {
  console.log(`He's dead, ${player}`);
};

redis.on('error', (err) => {
  console.error(`Error: ${err}`);
});

placeCoins((err) => {
  if (err) console.error('Coins could not be placed.');
  console.log('Game has begun.');
});
