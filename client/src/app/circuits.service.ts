///<reference path="circuit.ts"/>
import {Injectable} from '@angular/core';
import {Headers, Http, RequestOptions} from '@angular/http';

@Injectable()
export class CircuitsService {
  private circuitURL = 'http://127.0.0.1:8000'
  private staticLevel = this.circuitURL + '/level/';
  private guidedLevel = this.circuitURL + '/guidedlevel/'
   headers: Headers;
    options: RequestOptions;

  constructor(private http: Http) {
    this.headers = new Headers({'Accept': 'application/json'});
    this.options = new RequestOptions({headers: this.headers});


  }

  save_staticlevel(circuit): Promise<any> {
    return this.http.post(this.staticLevel, circuit, this.options).toPromise()
      .then(value => {value;console.log(value)})
      .catch(reason => console.log(reason));
  }

  load_staticlevel(num): Promise<any> {
    return this.http.get(this.staticLevel + num + '/')
      .toPromise()
      .then(response =>{return response.json() })
      .catch(reason => console.log(reason));
  }

  save_guidedlevel(circuit): Promise<any> {
    return this.http.post(this.guidedLevel, circuit, this.options).toPromise()
      .then(value => {
        value;
        console.log(value)
      })
      .catch(reason => console.log(reason));
  }

  load_guidedlevel(num): Promise<any> {
    return this.http.get(this.guidedLevel + num + '/')
      .toPromise()
      .then(response => {
        return response.json()
      })
      .catch(reason => console.log(reason));
  }




}
