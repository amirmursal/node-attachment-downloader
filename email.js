var inspect = require('util').inspect;
var fs = require('fs');
var base64 = require('base64-stream');
var Imap = require('imap');
var path = require('path');

var imap = new Imap({
    user: 'ardailyreports@gmail.com',
    password: 'nqql brsi kyao vyga',
    host: 'imap.gmail.com',
    port: 993,
    tls: true
});

function toUpper(thing) { return thing && thing.toUpperCase ? thing.toUpperCase() : thing; }

function findAttachmentParts(struct, attachments) {
    attachments = attachments || [];
    for (var i = 0, len = struct.length, r; i < len; ++i) {
        if (Array.isArray(struct[i])) {
            findAttachmentParts(struct[i], attachments);
        } else {
            if (struct[i].disposition && ['INLINE', 'ATTACHMENT'].indexOf(toUpper(struct[i].disposition.type)) > -1) {
                attachments.push(struct[i]);
            }
        }
    }
    return attachments;
}

function buildAttMessageFunction(attachment, dir) {
    var filename = path.join(dir, attachment.params.name);
    var encoding = attachment.encoding;

    return function (msg, seqno) {
        var prefix = '(#' + seqno + ') ';
        msg.on('body', function (stream, info) {
            // Check if file exists in the directory
            if (fs.existsSync(filename)) {
                var timestamp = new Date().toISOString().replace(/[-:.]/g, "");
                var newFilename = `${filename.split('.').slice(0, -1).join('.')}_${timestamp}.${filename.split('.').pop()}`;
                filename = newFilename;
            }

            console.log(prefix + 'Streaming this attachment to file', filename, info);
            var writeStream = fs.createWriteStream(filename);
            writeStream.on('finish', function () {
                console.log(prefix + 'Done writing to file %s', filename);
            });

            if (toUpper(encoding) === 'BASE64') {
                stream.pipe(new base64.Base64Decode()).pipe(writeStream);
            } else {
                stream.pipe(writeStream);
            }
        });
        msg.once('end', function () {
            console.log(prefix + 'Finished attachment %s', filename);
        });
    };
}

imap.once('ready', function () {
    var today = new Date();
    var formattedDate = today.toISOString().split('T')[0]; // Get YYYY-MM-DD format
    var dir = `attachments_${formattedDate}`;

    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    imap.openBox('INBOX', true, function (err, box) {
        if (err) throw err;
        imap.search(['UNSEEN', ['SINCE', 'August 2, 2024']], function (err, results) {
            if (err) throw err;
            var f = imap.fetch(results, { bodies: '', struct: true });
            f.on('message', function (msg, seqno) {
                console.log('Message #%d', seqno);
                var prefix = '(#' + seqno + ') ';
                msg.on('body', function (stream, info) {
                    var buffer = '';
                    stream.on('data', function (chunk) {
                        buffer += chunk.toString('utf8');
                    });
                    stream.once('end', function () {
                        console.log(prefix + 'Parsed header: %s', Imap.parseHeader(buffer));
                    });
                });
                msg.once('attributes', function (attrs) {
                    var attachments = findAttachmentParts(attrs.struct);
                    console.log(prefix + 'Has attachments: %d', attachments.length);
                    for (var i = 0, len = attachments.length; i < len; ++i) {
                        var attachment = attachments[i];
                        console.log(prefix + 'Fetching attachment %s', attachment.params.name);
                        var f = imap.fetch(attrs.uid, { bodies: [attachment.partID], struct: true });
                        f.on('message', buildAttMessageFunction(attachment, dir));
                    }
                });
                msg.once('end', function () {
                    console.log(prefix + 'Finished email');
                });
            });
            f.once('error', function (err) {
                console.log('Fetch error: ' + err);
            });
            f.once('end', function () {
                console.log('Done fetching all messages!');
                imap.end();
            });
        });
    });
});

imap.once('error', function (err) {
    console.log(err);
});

imap.once('end', function () {
    console.log('Connection ended');
});

imap.connect();
