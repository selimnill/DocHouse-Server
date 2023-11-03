const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { add } = require('date-fns');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);




const app = express();

// middleware
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send("Welcome To The Server");
});


app.use(function (request, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    //intercept the OPTIONS call so we don't double up on calls to the integration
    if ('OPTIONS' === request.method) {
      res.send(200);
    } else {
      next();
    }
  });




// database connecting

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.bjthsm0.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


// function verifyJWTtoken(req, res, next) {
//     const header = req.headers.authorization;
//     if (!header) {
//         return res.status(401).send('unauthorized access');
//     }
//     const token = header.split(' ')[1];
//     jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
//         // if (err) {
//         //     return res.status(403).send({ message: 'forbidden access' })
//         // }
//         req.decoded = decoded;
//         next();
//     })
// }



async function run() {
    try {
        const appointmentOptionCollection = client.db('AvailableAppointmentOptions').collection('AppointmentCollections');
        const bookingsCollection = client.db('AvailableAppointmentOptions').collection('bookings');
        const usersCollection = client.db('AvailableAppointmentOptions').collection('users');
        const doctorsCollection = client.db('AvailableAppointmentOptions').collection('doctors');
        const paymentsCollection = client.db('AvailableAppointmentOptions').collection('payments');


         // NOTE: make sure you use verifyAdmin after verifyJWT
        //  const verifyAdmin = async (req, res, next) =>{
        //     const decodedEmail = req.decoded.email;
        //     const query = { email: decodedEmail };
        //     const user = await usersCollection.findOne(query);
        //     // if (user?.role !== 'admin') {
        //     //     return res.status(403).send({ message: 'forbidden access' })
        //     // }
        //     next();
        // }


        // Use Aggregate to query multiple collection and then merge data
        app.get('/appointment', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();

            // get the bookings of the provided date
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

            // code carefully :D
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlots = optionBooked.map(book => book.slot);
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
            })
            res.send(options);
        });


        //  databse lookup aggregation
        app.get('/v2/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const options = await appointmentOptionCollection.aggregate([
                {
                    $lookup: {
                        from: 'bookings',
                        localField: 'name',
                        foreignField: 'treatment',
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$appointmentDate', date]
                                    }
                                }
                            }
                        ],
                        as: 'booked'
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: 1,
                        price: 1,
                        booked: {
                            $map: {
                                input: '$booked',
                                as: 'book',
                                in: '$$book.slot'
                            }
                        }
                    }
                },
                {
                    $project: {
                        name: 1,
                        price: 1,
                        slots: {
                            $setDifference: ['$slots', '$booked']
                        }
                    }
                }
            ]).toArray();
            res.send(options);
        })

        /***
         * API Naming Convention 
         * app.get('/bookings')
         * app.get('/bookings/:id')
         * app.post('/bookings')
         * app.patch('/bookings/:id')
         * app.delete('/bookings/:id')
        */


        app.get('/appointmentCategories', async(req, res) => {
            const query = {}
            const categories = await appointmentOptionCollection.find(query).project({name: 1}).toArray();
            res.send(categories);
        })


        

        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            }

            const alreadyBooked = await bookingsCollection.find(query).toArray();

            if (alreadyBooked.length) {
                const message = `You already have a booking on ${booking.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingsCollection.insertOne(booking);
            res.send(result);
        });


        // get bookings data from DataBase
        app.get('/bookings', async (req, res) => {
            const email = req.query.email;
            // const decodedEmail = req.decoded.email;

            // if(email !== decodedEmail){
            //     return res.status(403).send({message: 'forbidden access'})
            // }
            const query = { email: email }
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        })



        app.get('/bookings/:id', async(req, res) => {
            const id = req.params.id;
            const query = ({_id: new ObjectId(id)});
            const result = await bookingsCollection.findOne(query);
            res.send(result);
        })

        // jwt jenerator and find on db
        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            // console.log(user);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '24h' });
                return res.send({ accessToken: token });
            }
            res.status(403).send({ accessToken: '' });

        });



        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = usersCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users', async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users);
        });

        // app.get('/users/:id', async (req, res) => {
        //     const id = req.params.id;
        //     const query = ({_id: new ObjectId(id)})
        //     const result = await usersCollection.findOne(query);
        //     res.send(result);
        // });

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = {email};
            const user = await usersCollection.findOne(query);
            res.send({isAdmin: user?.role === 'admin'})
        })

        app.put('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true} ;
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        });

        app.get('/addprice', async(req, res) => {
            const query = {}
            const options = {upsert: true};
            const updatedDoc = {
                $set:{
                    price: 99
                }
            }
            const result = await appointmentOptionCollection.updateMany(query, updatedDoc, options);
            res.send(result);
        });

        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        app.post('/payments', async (req, res) =>{
            const payment = req.body;
            console.log(payment);
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId
            const filter = {_id: new ObjectId(id)}
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result);
        })
        

        app.post('/doctors',    async(req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        })
        app.get('/doctors', async(req, res) => {
            const query = {};
            const result = await doctorsCollection.find(query).toArray();
            res.send(result);
            console.log(result);
        });

        app.delete('/doctors/:id',  async (req, res) => {
            const id = req.params.id;
            const query = {_id: new ObjectId(id)};
            const result = await doctorsCollection.deleteOne(query);
            res.send(result);
        })

        // app.delete('/users/admin/:id',  async(req, res) => {
        //     const id = req.params.id;
        //     const query = {_id: new ObjectId(id)};
        //     const result = await usersCollection.deleteOne(query);
        //     res.send(result);
        // });

}
    finally {

}
}


run().catch(console.dir);







app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});