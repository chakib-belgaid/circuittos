import { Component, OnInit } from '@angular/core';
import * as http from 'http';
import {Http} from '@angular/http';

@Component({
  selector: 'app-stores',
  templateUrl: './stores.component.html',
  styleUrls: ['./stores.component.css']
})
export class StoresComponent implements OnInit {
  chaines: ;

  constructor(private http: Http) {  }

  ngOnInit() {
    this.getChaines();
  }

  private getChaines() {
    this.http.get('/app/chaines.json')
      .lift((res: Response) => res.json())
      .subscribe(
          data => {this.chaines = data; } ,
          err => console.error(err),
          () => console.log('done')
      );
  }
}
